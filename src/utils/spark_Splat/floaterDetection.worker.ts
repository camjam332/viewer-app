// src/utils/spark_Splat/floaterDetection.worker.ts
//
// Computes a per-splat "outlier score" via local k-NN density - a splat
// far from its neighbors (relative to the scene's overall density) is
// likely a reconstruction floater, the same reasoning as standard
// point-cloud statistical outlier removal. Deliberately a ONE-TIME,
// expensive pass, separate from applying any threshold to it: the
// threshold itself is meant to be a live, instantly-responsive slider,
// which only works if it's just comparing pre-computed scores rather
// than re-running neighbor search on every drag tick.
//
// Reuses buildKDTree/kNearest from measurement_utils.tsx (the same
// k-d tree already trusted for geodesic measurement) rather than a
// separate implementation - this is a genuine density query, not a
// graph-connectivity one, but the underlying "find nearby points fast"
// primitive is identical.
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
  // Already-extracted, already-world-space centers - reused from
  // extractSparkSplatCentersAsync's output rather than re-decoded here,
  // since App.tsx already has them from the geodesic measurement
  // pipeline. Avoids paying for center decoding twice.
  centers: Float32Array;
  // Still needed for opacity specifically - unpackSplat decodes a whole
  // splat's fields at once (there's no "just opacity" shortcut in the
  // public API), so this pass re-decodes each splat once. The
  // alternative - hand-parsing just the opacity bits ourselves - would
  // mean depending on Spark's exact packing layout instead of its public
  // decode function, which is the same reimplementation risk considered
  // and rejected for splatCenters.worker.ts.
  packedArray: Uint32Array;
  numSplats: number;
  splatEncoding?: SplatEncoding;
  k: number;
};

type AnalyzeResponse = {
  requestId: number;
  // meanNeighborDistance / medianOfAllMeanNeighborDistances, per splat -
  // 1.0 is typical local density, higher means sparser/more isolated.
  scores: Float32Array;
  // Original opacity per splat, captured before anything ever hides
  // one - needed to restore a splat exactly when the threshold moves
  // back past it, since setSplat rewrites the full entry (there's no
  // partial "just opacity" write either).
  opacities: Float32Array;
};

ctx.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { requestId, centers, packedArray, numSplats, splatEncoding, k } =
    e.data;

  const opacities = new Float32Array(numSplats);
  for (let i = 0; i < numSplats; i++) {
    opacities[i] = unpackSplat(packedArray, i, splatEncoding).opacity;
  }

  const tree = buildKDTree(centers);
  const meanNeighborDist = new Float32Array(numSplats);

  for (let i = 0; i < numSplats; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    const neighbors = kNearest(tree, x, y, z, k, i);
    if (neighbors.length === 0) {
      meanNeighborDist[i] = 0;
      continue;
    }
    let sum = 0;
    for (const n of neighbors) sum += Math.sqrt(n.distSq);
    meanNeighborDist[i] = sum / neighbors.length;
  }

  // Median rather than mean as the normalizing baseline - a scene's
  // neighbor-distance distribution is exactly the kind of thing floaters
  // themselves skew heavily (a few splats floating far away inflate a
  // mean but barely move a median), so mean would keep raising its own
  // yardstick against the outliers it's supposed to be measuring.
  const sorted = Float32Array.from(meanNeighborDist).sort();
  const median = sorted[Math.floor(sorted.length / 2)] || 1;

  const scores = new Float32Array(numSplats);
  for (let i = 0; i < numSplats; i++) {
    scores[i] = median > 0 ? meanNeighborDist[i] / median : 1;
  }

  const response: AnalyzeResponse = { requestId, scores, opacities };
  ctx.postMessage(response, [scores.buffer, opacities.buffer]);
};