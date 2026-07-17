// src/utils/spark_Splat/floaterDetection.worker.ts
//
// Computes, per splat, the size of the connected component it belongs
// to (as a fraction of the whole scene) - not a local density score.
//
// The original version scored each splat by its own local neighbor
// density (mean k-NN distance vs. the scene median) - the same idea as
// standard point-cloud statistical outlier removal. That measures
// "is this point locally sparse," which a genuine floater and a
// genuinely sparse-but-real structure (a thin wire, a chair leg, the
// edge of the capture) both satisfy for the same underlying reason -
// local density alone can't tell them apart, confirmed in practice: it
// was removing real detail along with actual floaters.
//
// Connected-component analysis asks a different question: is this point
// part of the same connected mass as most of the scene, or does it
// belong to its own small, isolated island? A tight little floater
// cluster would score WELL under local density (its own few points are
// close together) but is still its own disconnected component. A thin
// wire is locally sparse but still chained, point to point, into the
// main structure - one connected component, just an elongated one. This
// is the distinction that actually matches "is this a floater," not
// local density.
//
// Reuses buildKDTree/kNearest from measurement_utils.tsx (the same
// k-d tree already trusted for geodesic measurement) to build the
// proximity graph, then Union-Find (path halving + union by size) to
// label components - both are standard, well-understood primitives, not
// something novel that needs its own from-scratch trust-building.
import { unpackSplat } from "@sparkjsdev/spark";
import { buildKDTree, kNearest } from "../measurement_utils";

const ctx = self as unknown as Worker;

type SplatEncoding = {
  rgbMin?: number;
  rgbMax?: number;
  lnScaleMin?: number;
  lnScaleMax?: number;
  lodOpacity?: boolean;
};

type AnalyzeRequest = {
  requestId: number;
  centers: Float32Array;
  packedArray: Uint32Array;
  numSplats: number;
  splatEncoding?: SplatEncoding;
  // Number of candidate neighbors checked per splat when building the
  // proximity graph - not the same k as the old density score, though
  // it plays a similar role. Needs to be large enough that a genuinely
  // connected structure doesn't get accidentally split just because more
  // than k points happen to be clustered on one side of a splat.
  k: number;
  // How generous the per-connection local radius is, as a multiple of
  // the larger of the two points' own local spacing - exposed as a
  // user-adjustable control (see App.tsx/FloaterCleanupPanel.tsx) rather
  // than hardcoded, since the right value is genuinely scene-dependent
  // and no single number held up across the two very different real
  // captures this was tested against during development.
  radiusMultiplier: number;
};

type AnalyzeResponse = {
  requestId: number;
  // Component size / total splat count, per splat - NOT a distance-based
  // score anymore. A splat in the scene's dominant mass will be close to
  // 1.0; a splat in a small, disconnected floater cluster will be close
  // to (cluster size / total), a small number.
  componentSizeFractions: Float32Array;
  opacities: Float32Array;
};

/**
 * Union-Find (disjoint set union) with path halving and union-by-size -
 * standard, near-linear-time connected component labeling. Not something
 * built from scratch for novelty's sake; this is the textbook structure
 * for exactly this problem, chosen because it's well-understood and easy
 * to verify correct, not because anything fancier was needed.
 */
class UnionFind {
  private parent: Int32Array;
  private size: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path halving
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) {
      this.parent[ra] = rb;
      this.size[rb] += this.size[ra];
    } else {
      this.parent[rb] = ra;
      this.size[ra] += this.size[rb];
    }
  }

  componentSize(x: number): number {
    return this.size[this.find(x)];
  }
}

ctx.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const {
    requestId,
    centers,
    packedArray,
    numSplats,
    splatEncoding,
    k,
    radiusMultiplier,
  } = e.data;

  const opacities = new Float32Array(numSplats);
  for (let i = 0; i < numSplats; i++) {
    opacities[i] = unpackSplat(packedArray, i, splatEncoding).opacity;
  }

  const tree = buildKDTree(centers);

  // Per-point local spacing (single-nearest-neighbor distance) - used
  // below as an ADAPTIVE, per-connection scale rather than a single
  // scene-wide cutoff. A dense object scan doesn't have uniform density
  // the way a room capture roughly does: a flat, easy-to-capture surface
  // reconstructs densely and uniformly, while genuinely real detail -
  // tread grooves, laces, fine texture - is naturally sparser for
  // reasons that have nothing to do with being a floater. A single
  // global radius, tuned to the scene's overall density, was confirmed
  // (via a real test capture) to fracture that legitimately-sparser
  // detail into many small islands and discard it as noise - the exact
  // "removing genuine detail along with floaters" symptom this is
  // fixing. Judging each connection against the local density right
  // around those two specific points, rather than the whole scene's
  // average, lets a sparse-but-real region get a correspondingly looser
  // allowance while a true isolated floater - whose own local density
  // stays tight no matter how the object's density varies elsewhere -
  // still gets caught.
  const nearestDist = new Float32Array(numSplats);
  for (let i = 0; i < numSplats; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    const nearest = kNearest(tree, x, y, z, 1, i);
    nearestDist[i] = nearest.length > 0 ? Math.sqrt(nearest[0].distSq) : 0;
  }

  const uf = new UnionFind(numSplats);
  for (let i = 0; i < numSplats; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    const neighbors = kNearest(tree, x, y, z, k, i);
    for (const n of neighbors) {
      // The larger of the two points' own local spacing, not the
      // smaller - a connection should be allowed if EITHER point is in a
      // naturally sparser area, not only if both are.
      const localScale = Math.max(nearestDist[i], nearestDist[n.idx]);
      const localRadiusSq = (localScale * radiusMultiplier) ** 2;
      if (n.distSq <= localRadiusSq) {
        uf.union(i, n.idx);
      }
    }
  }

  const componentSizeFractions = new Float32Array(numSplats);
  for (let i = 0; i < numSplats; i++) {
    componentSizeFractions[i] = uf.componentSize(i) / numSplats;
  }

  const response: AnalyzeResponse = {
    requestId,
    componentSizeFractions,
    opacities,
  };
  ctx.postMessage(response, [
    componentSizeFractions.buffer,
    opacities.buffer,
  ]);
};