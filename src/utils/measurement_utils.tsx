import * as THREE from "three";
import {
  BufferGeometry,
  BufferAttribute,
  InterleavedBufferAttribute,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type AdjacencyMap = Map<number, number>;
export type AdjacencyGraph = AdjacencyMap[];

export function buildMeshGraph(geometry: BufferGeometry): AdjacencyGraph {
  const positions: BufferAttribute | InterleavedBufferAttribute = geometry
    .attributes.position as BufferAttribute;
  const index = geometry.index; // BufferAttribute | null
  const vertexCount: number = positions.count;

  const adjacency: AdjacencyGraph = Array.from(
    { length: vertexCount },
    () => new Map<number, number>(),
  );

  const addEdge = (a: number, b: number): void => {
    if (adjacency[a].has(b)) return;
    const va = new THREE.Vector3().fromBufferAttribute(positions, a);
    const vb = new THREE.Vector3().fromBufferAttribute(positions, b);
    const dist: number = va.distanceTo(vb);
    adjacency[a].set(b, dist);
    adjacency[b].set(a, dist);
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a: number = index.getX(i);
      const b: number = index.getX(i + 1);
      const c: number = index.getX(i + 2);
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  } else {
    for (let i = 0; i < vertexCount; i += 3) {
      addEdge(i, i + 1);
      addEdge(i + 1, i + 2);
      addEdge(i + 2, i);
    }
  }

  return adjacency;
}

// A heap entry is a tuple: [distance, vertexIndex]
type HeapEntry = [number, number];

export interface GeodesicResult {
  distance: number;
  path: number[];
}

export function geodesicDistance(
  adjacency: AdjacencyGraph,
  startIdx: number,
  endIdx: number,
): GeodesicResult {
  const dist = new Float64Array(adjacency.length).fill(Infinity);
  const prev = new Int32Array(adjacency.length).fill(-1);
  const visited = new Uint8Array(adjacency.length);

  dist[startIdx] = 0;

  const heap: HeapEntry[] = [[0, startIdx]];

  const pushHeap = (item: HeapEntry): void => {
    heap.push(item);
    let i: number = heap.length - 1;
    while (i > 0) {
      const parent: number = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const popHeap = (): HeapEntry => {
    const top: HeapEntry = heap[0];
    const last: HeapEntry = heap.pop() as HeapEntry;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l: number = 2 * i + 1;
        const r: number = 2 * i + 2;
        let smallest: number = i;
        if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  while (heap.length) {
    const [d, u]: HeapEntry = popHeap();
    if (visited[u]) continue;
    visited[u] = 1;
    if (u === endIdx) break;

    for (const [v, weight] of adjacency[u]) {
      if (visited[v]) continue;
      const nd: number = d + weight;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        pushHeap([nd, v]);
      }
    }
  }

  const path: number[] = [];
  let cur: number = endIdx;
  while (cur !== -1) {
    path.unshift(cur);
    cur = prev[cur];
  }

  return { distance: dist[endIdx], path };
}

/**
 * Finds the index of the mesh vertex closest to a given world-space point.
 * Assumes `point` has already been transformed into the geometry's local
 * space (i.e. inverse of the mesh's world matrix applied), since vertex
 * positions in the BufferGeometry are local, not world, coordinates.
 */
export function findNearestVertexIndex(
  geometry: BufferGeometry,
  point: THREE.Vector3,
): number {
  const positions: BufferAttribute | InterleavedBufferAttribute = geometry
    .attributes.position as BufferAttribute;

  let closestIdx: number = -1;
  let closestDistSq: number = Infinity;

  const v = new THREE.Vector3(); // reused scratch vector, avoids GC churn

  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    const distSq: number = v.distanceToSquared(point);
    if (distSq < closestDistSq) {
      closestDistSq = distSq;
      closestIdx = i;
    }
  }

  return closestIdx;
}

/**
 * Reduces a geometry to position (+ index) only, then welds coincident
 * vertices. Welding on position-only avoids the common trap where
 * mergeVertices treats seam vertices as distinct because their normals
 * or UVs differ, even though they share the same 3D position.
 */
export function buildWeldedPositionGeometry(
  source: BufferGeometry,
  tolerance = 1e-4,
): BufferGeometry {
  const posAttr = source.attributes.position as BufferAttribute;

  const positionOnly = new BufferGeometry();
  positionOnly.setAttribute("position", posAttr.clone());
  if (source.index) {
    positionOnly.setIndex(source.index.clone());
  }

  return mergeVertices(positionOnly, tolerance);
}

// ---------------------------------------------------------------------
// Splat point-cloud geodesic approximation
//
// Gaussian splats have no real surface topology - no vertices/faces/edges
// the way a mesh does, just an unstructured cloud of splat centers. There
// is no exact equivalent of mesh geodesic distance for them. What follows
// instead approximates it: connect each splat to its k nearest neighbors
// (by center-to-center distance) into a graph, then run the exact same
// Dijkstra used for meshes over that graph. This is a legitimate,
// published technique for approximating geodesics on point clouds when a
// true mesh isn't available - but it's an approximation that depends on
// point density/uniformity, not a true surface-constrained shortest path.
// ---------------------------------------------------------------------

type KDNode = {
  idx: number;
  axis: 0 | 1 | 2;
  left: KDNode | null;
  right: KDNode | null;
};

export type SplatKDTree = {
  root: KDNode | null;
  /** Flat, interleaved xyz positions - NOT copied, shared by reference. */
  points: Float32Array;
};

type Neighbor = { idx: number; distSq: number };

function distSqTo(
  points: Float32Array,
  idx: number,
  x: number,
  y: number,
  z: number,
): number {
  const dx = points[idx * 3] - x;
  const dy = points[idx * 3 + 1] - y;
  const dz = points[idx * 3 + 2] - z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Builds a k-d tree over a flat, interleaved xyz point array. One-time
 * O(n log^2 n) cost (sorts the relevant sub-range at every split level,
 * rather than a more involved O(n log n) quickselect-based build) - fine
 * for a one-time, load-time operation running in a worker, but worth
 * knowing if it ever needs to scale to very large point counts.
 */
export function buildKDTree(points: Float32Array): SplatKDTree {
  const count = points.length / 3;
  const indices = new Int32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;

  function build(lo: number, hi: number, depth: number): KDNode | null {
    if (lo >= hi) return null;
    const axis = (depth % 3) as 0 | 1 | 2;
    // Sorting this subarray VIEW mutates the corresponding slice of
    // `indices` in place - no extra copies needed.
    const sub = indices.subarray(lo, hi);
    sub.sort((a, b) => points[a * 3 + axis] - points[b * 3 + axis]);
    const mid = lo + ((hi - lo) >> 1);
    return {
      idx: indices[mid],
      axis,
      left: build(lo, mid, depth + 1),
      right: build(mid + 1, hi, depth + 1),
    };
  }

  return { root: build(0, count, 0), points };
}

/**
 * Finds the k nearest neighbors to (x, y, z). `excludeIdx` skips a
 * point's own index when building a graph (a point is never its own
 * neighbor). k is expected to be small (single digits), so a simple
 * insertion-sorted candidate array is used instead of a proper heap -
 * simpler to verify correct, and the difference is negligible at this k.
 */
export function kNearest(
  tree: SplatKDTree,
  x: number,
  y: number,
  z: number,
  k: number,
  excludeIdx = -1,
): Neighbor[] {
  const best: Neighbor[] = [];

  function insert(idx: number, dSq: number) {
    if (idx === excludeIdx) return;
    if (best.length < k) {
      best.push({ idx, distSq: dSq });
      best.sort((a, b) => a.distSq - b.distSq);
    } else if (dSq < best[best.length - 1].distSq) {
      best[best.length - 1] = { idx, distSq: dSq };
      best.sort((a, b) => a.distSq - b.distSq);
    }
  }

  function search(node: KDNode | null) {
    if (!node) return;
    insert(node.idx, distSqTo(tree.points, node.idx, x, y, z));

    const axisVal = node.axis === 0 ? x : node.axis === 1 ? y : z;
    const nodeVal = tree.points[node.idx * 3 + node.axis];
    const diff = axisVal - nodeVal;

    const nearChild = diff < 0 ? node.left : node.right;
    const farChild = diff < 0 ? node.right : node.left;

    search(nearChild);
    // Only descend into the far side if it could still contain a point
    // closer than our current worst-of-k candidate.
    if (best.length < k || diff * diff < best[best.length - 1].distSq) {
      search(farChild);
    }
  }

  search(tree.root);
  return best;
}

/**
 * Builds an approximate-geodesic adjacency graph over a splat point cloud
 * by connecting each splat to its k nearest neighbors. Same AdjacencyGraph
 * shape as buildMeshGraph, so the existing geodesicDistance() works
 * unchanged against either source.
 */
export function buildSplatGraph(
  points: Float32Array,
  k = 8,
): { tree: SplatKDTree; adjacency: AdjacencyGraph } {
  const tree = buildKDTree(points);
  const count = points.length / 3;
  const adjacency: AdjacencyGraph = Array.from(
    { length: count },
    () => new Map<number, number>(),
  );
  for (let i = 0; i < count; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    const neighbors = kNearest(tree, x, y, z, k, i);
    for (const { idx, distSq } of neighbors) {
      const dist = Math.sqrt(distSq);
      adjacency[i].set(idx, dist);
      adjacency[idx].set(i, dist);
    }
  }

  return { tree, adjacency };
}

/** Finds the index of the single nearest splat center to a world-space point. */
export function findNearestSplatIndex(
  tree: SplatKDTree,
  point: THREE.Vector3,
): number {
  const result = kNearest(tree, point.x, point.y, point.z, 1);
  return result.length > 0 ? result[0].idx : -1;
}

/**
 * Applies a THREE.Matrix4 (by its .elements, column-major) to a flat,
 * interleaved xyz point array in place. Avoids allocating a Vector3 per
 * point, which matters when transforming hundreds of thousands of splat
 * centers into world space.
 */
export function applyMatrix4ToFlatPoints(
  points: Float32Array,
  elements: ArrayLike<number>,
): void {
  const e0 = elements[0],
    e1 = elements[1],
    e2 = elements[2];
  const e4 = elements[4],
    e5 = elements[5],
    e6 = elements[6];
  const e8 = elements[8],
    e9 = elements[9],
    e10 = elements[10];
  const e12 = elements[12],
    e13 = elements[13],
    e14 = elements[14];

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    points[i] = e0 * x + e4 * y + e8 * z + e12;
    points[i + 1] = e1 * x + e5 * y + e9 * z + e13;
    points[i + 2] = e2 * x + e6 * y + e10 * z + e14;
  }
}
