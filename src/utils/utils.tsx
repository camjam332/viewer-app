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
