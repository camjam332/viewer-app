import { BufferGeometry, Vector3 } from "three";
import TinyQueue from "tinyqueue";

export function snapToNearestVertex(intersection, geometry: BufferGeometry) {
  const { face, point } = intersection;
  const pos = geometry.attributes.position;
  const candidates = [face.a, face.b, face.c];

  let closestIdx = candidates[0];
  let closestDist = Infinity;
  const vertexWorld = new Vector3();

  for (const idx of candidates) {
    vertexWorld.fromBufferAttribute(pos, idx);
    // if geometry is transformed, apply the mesh's worldMatrix here
    const dist = vertexWorld.distanceTo(point);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = idx;
    }
  }

  return closestIdx; // local vertex index, ready for dijkstraGeodesic
}

export function buildAdjacency(geometry: BufferGeometry) {
  const pos = geometry.attributes.position;
  if (!geometry.index) return;
  const index = geometry.index.array;
  const adjacency = new Map(); // vertexIndex -> Map(neighborIndex -> distance)

  const addEdge = (a: number, b: number) => {
    const dist = new Vector3()
      .fromBufferAttribute(pos, a)
      .distanceTo(new Vector3().fromBufferAttribute(pos, b));
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    if (!adjacency.has(b)) adjacency.set(b, new Map());
    adjacency.get(a).set(b, dist);
    adjacency.get(b).set(a, dist);
  };

  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return adjacency;
}

export function dijkstraGeodesic(adjacency, startIdx, endIdx) {
  const dist = new Map([[startIdx, 0]]);
  const prev = new Map();
  const visited = new Set();
  const pq = new TinyQueue([[0, startIdx]], (a, b) => a[0] - b[0]);

  while (pq.length) {
    const [d, u] = pq.pop();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === endIdx) break;

    for (const [v, w] of adjacency.get(u) ?? []) {
      const alt = d + w;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, u);
        pq.push([alt, v]);
      }
    }
  }

  return {
    distance: dist.get(endIdx),
    path: reconstructPath(prev, startIdx, endIdx),
  };
}

export function reconstructPath(prev, start, end) {
  const path = [end];
  let cur = end;
  while (cur !== start) {
    cur = prev.get(cur);
    if (cur === undefined) return null; // unreachable
    path.push(cur);
  }
  return path.reverse();
}
