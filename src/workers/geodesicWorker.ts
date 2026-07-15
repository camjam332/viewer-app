import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  buildMeshGraph,
  buildWeldedPositionGeometry,
  findNearestVertexIndex,
  buildSplatGraph,
  findNearestSplatIndex,
  geodesicDistance,
  type AdjacencyGraph,
  type SplatKDTree,
} from "../utils/measurement_utils";

export type MeshBuffers = {
  position: Float32Array;
  index: Uint32Array | Uint16Array | null;
};

export type GeodesicWorkerRequest =
  | { type: "buildGraph"; requestId: number; meshes: MeshBuffers[] }
  | {
      type: "buildSplatGraph";
      requestId: number;
      centers: Float32Array;
      k?: number;
    }
  | {
      type: "computeGeodesic";
      requestId: number;
      pointA: [number, number, number];
      pointB: [number, number, number];
    };

export type GeodesicWorkerResponse =
  | { type: "graphReady"; requestId: number }
  | {
      type: "geodesicResult";
      requestId: number;
      distance: number;
      path: Float32Array;
    }
  | { type: "error"; requestId: number; message: string };

// Runs inside the worker thread; kept as module state so it survives
// between the (infrequent) graph rebuild and the (frequent) point
// queries. Exactly one of (weldedGeometry) / (splatTree) is populated
// depending on graphMode - adjacency has the same shape either way, since
// buildMeshGraph and buildSplatGraph both produce a plain AdjacencyGraph.
let weldedGeometry: BufferGeometry | null = null;
let splatTree: SplatKDTree | null = null;
let adjacency: AdjacencyGraph | null = null;
let graphMode: "mesh" | "splat" | null = null;



const ctx = self as unknown as Worker;

function toGeometry({ position, index }: MeshBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  if (index) {
    geometry.setIndex(new BufferAttribute(index, 1));
  }
  return geometry;
}

function resetGraphState() {
  weldedGeometry = null;
  splatTree = null;
  adjacency = null;
  graphMode = null;
}

ctx.onmessage = (event: MessageEvent<GeodesicWorkerRequest>) => {
  const data = event.data;
  console.log(data.type)
  if (data.type === "buildGraph") {
    try {
      const merged = mergeGeometries(data.meshes.map(toGeometry));
      if (!merged) {
        resetGraphState();
        ctx.postMessage({
          type: "error",
          requestId: data.requestId,
          message: "Failed to merge geometries",
        } satisfies GeodesicWorkerResponse);
        return;
      }
      weldedGeometry = buildWeldedPositionGeometry(merged, 0.00001);
      adjacency = buildMeshGraph(weldedGeometry);
      splatTree = null;
      graphMode = "mesh";
      ctx.postMessage({
        type: "graphReady",
        requestId: data.requestId,
      } satisfies GeodesicWorkerResponse);
    } catch (err) {
      resetGraphState();
      ctx.postMessage({
        type: "error",
        requestId: data.requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies GeodesicWorkerResponse);
    }
    return;
  }

  if (data.type === "buildSplatGraph") {
    try {
      const { tree, adjacency: adj } = buildSplatGraph(
        data.centers,
        data.k ?? 8,
      );
      splatTree = tree;
      adjacency = adj;
      weldedGeometry = null;
      graphMode = "splat";
      ctx.postMessage({
        type: "graphReady",
        requestId: data.requestId,
      } satisfies GeodesicWorkerResponse);
    } catch (err) {
      resetGraphState();
      ctx.postMessage({
        type: "error",
        requestId: data.requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies GeodesicWorkerResponse);
    }
    return;
  }

  if (data.type === "computeGeodesic") {
    if (!adjacency || !graphMode) {
      ctx.postMessage({
        type: "error",
        requestId: data.requestId,
        message: "Graph not built yet",
      } satisfies GeodesicWorkerResponse);
      return;
    }

    let startIdx: number;
    let endIdx: number;
    let getPosition: (idx: number) => [number, number, number];

    if (graphMode === "mesh") {
      if (!weldedGeometry) {
        ctx.postMessage({
          type: "error",
          requestId: data.requestId,
          message: "Mesh graph not built yet",
        } satisfies GeodesicWorkerResponse);
        return;
      }
      startIdx = findNearestVertexIndex(
        weldedGeometry,
        new Vector3(...data.pointA),
      );
      endIdx = findNearestVertexIndex(
        weldedGeometry,
        new Vector3(...data.pointB),
      );
      const positions = weldedGeometry.attributes.position as BufferAttribute;
      getPosition = (idx) => [
        positions.getX(idx),
        positions.getY(idx),
        positions.getZ(idx),
      ];
    } else {
      if (!splatTree) {
        ctx.postMessage({
          type: "error",
          requestId: data.requestId,
          message: "Splat graph not built yet",
        } satisfies GeodesicWorkerResponse);
        return;
      }
      startIdx = findNearestSplatIndex(splatTree, new Vector3(...data.pointA));
      endIdx = findNearestSplatIndex(splatTree, new Vector3(...data.pointB));
      const pts = splatTree.points;
      getPosition = (idx) => [
        pts[idx * 3],
        pts[idx * 3 + 1],
        pts[idx * 3 + 2],
      ];
    }
    console.log('start calculation')
    const { distance, path } = geodesicDistance(adjacency, startIdx, endIdx);

    const pathBuffer = new Float32Array(path.length * 3);
    for (let i = 0; i < path.length; i++) {
      const [x, y, z] = getPosition(path[i]);
      pathBuffer[i * 3] = x;
      pathBuffer[i * 3 + 1] = y;
      pathBuffer[i * 3 + 2] = z;
    }
    console.log('finish calculation')

    ctx.postMessage(
      {
        type: "geodesicResult",
        requestId: data.requestId,
        distance,
        path: pathBuffer,
      } satisfies GeodesicWorkerResponse,
      { transfer: [pathBuffer.buffer] },
    );
  }
};