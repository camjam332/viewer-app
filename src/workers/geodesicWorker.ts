import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  buildMeshGraph,
  buildWeldedPositionGeometry,
  findNearestVertexIndex,
  geodesicDistance,
  type AdjacencyGraph,
} from "../utils/measurement_utils";

export type MeshBuffers = {
  position: Float32Array;
  index: Uint32Array | Uint16Array | null;
};

export type GeodesicWorkerRequest =
  | { type: "buildGraph"; requestId: number; meshes: MeshBuffers[] }
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
// between the (infrequent) graph rebuild and the (frequent) point queries.
let weldedGeometry: BufferGeometry | null = null;
let adjacency: AdjacencyGraph | null = null;

const ctx = self as unknown as Worker;

function toGeometry({ position, index }: MeshBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  if (index) {
    geometry.setIndex(new BufferAttribute(index, 1));
  }
  return geometry;
}

ctx.onmessage = (event: MessageEvent<GeodesicWorkerRequest>) => {
  const data = event.data;

  if (data.type === "buildGraph") {
    try {
      const merged = mergeGeometries(data.meshes.map(toGeometry));
      if (!merged) {
        weldedGeometry = null;
        adjacency = null;
        ctx.postMessage({
          type: "error",
          requestId: data.requestId,
          message: "Failed to merge geometries",
        } satisfies GeodesicWorkerResponse);
        return;
      }
      weldedGeometry = buildWeldedPositionGeometry(merged, 0.00001);
      adjacency = buildMeshGraph(weldedGeometry);
      ctx.postMessage({
        type: "graphReady",
        requestId: data.requestId,
      } satisfies GeodesicWorkerResponse);
    } catch (err) {
      weldedGeometry = null;
      adjacency = null;
      ctx.postMessage({
        type: "error",
        requestId: data.requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies GeodesicWorkerResponse);
    }
    return;
  }

  if (data.type === "computeGeodesic") {
    if (!weldedGeometry || !adjacency) {
      ctx.postMessage({
        type: "error",
        requestId: data.requestId,
        message: "Mesh graph not built yet",
      } satisfies GeodesicWorkerResponse);
      return;
    }

    const startIdx = findNearestVertexIndex(
      weldedGeometry,
      new Vector3(...data.pointA),
    );
    const endIdx = findNearestVertexIndex(
      weldedGeometry,
      new Vector3(...data.pointB),
    );
    const { distance, path } = geodesicDistance(adjacency, startIdx, endIdx);

    const positions = weldedGeometry.attributes.position as BufferAttribute;
    const pathBuffer = new Float32Array(path.length * 3);
    for (let i = 0; i < path.length; i++) {
      pathBuffer[i * 3] = positions.getX(path[i]);
      pathBuffer[i * 3 + 1] = positions.getY(path[i]);
      pathBuffer[i * 3 + 2] = positions.getZ(path[i]);
    }

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
