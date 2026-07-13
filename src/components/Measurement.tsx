import { Line } from "@react-three/drei";
import { useMeasurement } from "../state/measurementState";
import { useViewer } from "../state/state";
import { BufferAttribute, Mesh, Object3D, Vector3 } from "three";
import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  GeodesicWorkerRequest,
  GeodesicWorkerResponse,
  MeshBuffers,
} from "../workers/geodesicWorker";
import { MARKER_SPHERE_GEOMETRY } from "../utils/markerGeometry";

type MeasurementProps = {
  modelRef: RefObject<Object3D | null>;
  modelUrl: string | null;
  /** Present only once a splat scene has finished loading; null in mesh mode. */
  /**
   * Flat, world-space, interleaved xyz splat centers - already extracted
   * and transformed by whichever splat library is currently loaded (see
   * sparkSplat_utils.ts's extractSparkSplatCenters). Keeps this component
   * library-agnostic: it doesn't know or care whether the centers came
   * from Spark, GaussianSplats3D, or anything else, only that it's a
   * plain Float32Array - same reason buildSplatGraph/geodesicWorker.ts
   * were already written this way.
   */
  splatCenters?: Float32Array | null;
};

type DrapedResult = { points: Vector3[]; distance: number };

export const Measurement = ({
  modelRef,
  modelUrl,
  splatCenters,
}: MeasurementProps) => {
  const points = useMeasurement((s) => s.points);
  const setSurfaceDistance = useMeasurement((s) => s.setSurfaceDistance);
  const markerScale = useViewer((s) => s.markerScale);
  const measurementMode = useMeasurement((s) => s.mode);

  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  const graphRequestIdRef = useRef<number | null>(null);
  const geodesicRequestIdRef = useRef<number | null>(null);
  const graphReadyRef = useRef(false);
  const [graphReadyToken, setGraphReadyToken] = useState(0);
  const [draped, setDraped] = useState<DrapedResult | null>(null);

  // The graph build (weld + adjacency, or k-d tree + kNN graph) and the
  // Dijkstra search are both O(vertex/splat count) or worse, which freezes
  // the main thread on dense meshes or large splat clouds. Offload them to
  // a worker so the UI stays responsive.
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/geodesicWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<GeodesicWorkerResponse>) => {
      const data = event.data;
      if (data.type === "graphReady") {
        if (data.requestId !== graphRequestIdRef.current) return; // stale
        graphReadyRef.current = true;
        setGraphReadyToken((t) => t + 1);
      } else if (data.type === "geodesicResult") {
        if (data.requestId !== geodesicRequestIdRef.current) return; // stale
        const pathPoints: Vector3[] = [];
        for (let i = 0; i < data.path.length; i += 3) {
          pathPoints.push(
            new Vector3(data.path[i], data.path[i + 1], data.path[i + 2]),
          );
        }
        setDraped({ points: pathPoints, distance: data.distance });
      } else if (data.type === "error") {
        if (data.requestId === graphRequestIdRef.current) {
          graphReadyRef.current = false;
        }
        if (data.requestId === geodesicRequestIdRef.current) {
          setDraped(null);
        }
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Rebuild the MESH graph only when the model itself changes. Depends on
  // modelUrl rather than modelRef.current: mutating a ref doesn't trigger a
  // re-render, so an effect keyed on ref.current only re-runs when some
  // *other* state change happens to cause a re-render around the same
  // time - true here today (clearPoints() on load coincides), but that's
  // incidental, not guaranteed, and could silently rebuild the graph
  // against a stale or wrong mesh if that coincidence ever breaks.
  //
  // In splat mode modelRef.current is always null (Model never mounts),
  // so this naturally no-ops and defers to the splat-graph effect below.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    if (!modelRef.current) {
      graphReadyRef.current = false;
      setDraped(null);
      return;
    }

    modelRef.current.updateWorldMatrix(true, true);
    const meshes: MeshBuffers[] = [];
    modelRef.current.traverse((node) => {
      if (node instanceof Mesh) {
        const geom = node.geometry.clone();
        geom.applyMatrix4(node.matrixWorld);
        const position = (geom.attributes.position as BufferAttribute)
          .array as Float32Array;
        const index = geom.index
          ? (geom.index.array as Uint32Array | Uint16Array)
          : null;
        meshes.push({ position, index });
      }
    });
    if (meshes.length === 0) {
      graphReadyRef.current = false;
      setDraped(null);
      return;
    }

    const requestId = ++nextRequestId.current;
    graphRequestIdRef.current = requestId;
    graphReadyRef.current = false;
    setDraped(null);

    const transfer: Transferable[] = [];
    meshes.forEach(({ position, index }) => {
      transfer.push(position.buffer);
      if (index) transfer.push(index.buffer);
    });
    const message: GeodesicWorkerRequest = {
      type: "buildGraph",
      requestId,
      meshes,
    };
    worker.postMessage(message, transfer);
  }, [modelUrl]);

  // Rebuild the SPLAT graph whenever a new splatCenters array arrives -
  // keyed on the array's own identity, which changes exactly once per
  // successful splat load (see extractSparkSplatCenters /
  // handleSparkSplatLoad), same reasoning as keying on splatMesh identity
  // used to have. Extraction/world-space transform already happened
  // upstream - this effect doesn't know or care which splat library
  // produced the array.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !splatCenters || splatCenters.length === 0) {
      graphReadyRef.current = false;
      setDraped(null);
      return;
    }

    const requestId = ++nextRequestId.current;
    graphRequestIdRef.current = requestId;
    graphReadyRef.current = false;
    setDraped(null);

    // Deliberately NOT transferring ownership of splatCenters.buffer here -
    // the array is owned by App-level React state (shared, not a
    // throwaway created just for this message), and a transfer would
    // detach/empty it out from under that state. A structured-clone copy
    // costs a bit more, but for a few hundred thousand splats (a few MB)
    // that's negligible next to the correctness risk.
    const message: GeodesicWorkerRequest = {
      type: "buildSplatGraph",
      requestId,
      centers: splatCenters,
      k: 8,
    };
    worker.postMessage(message);
  }, [splatCenters]);

  // Recompute the geodesic path whenever the measurement points (or the
  // freshly-built graph) change. Fully generic over mesh/splat - the
  // worker already resolved which graph is active.
  useEffect(() => {
    if (
      points.length !== 2 ||
      measurementMode === "linear" ||
      !graphReadyRef.current
    ) {
      geodesicRequestIdRef.current = null; // invalidate any in-flight result
      setDraped(null);
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;

    const [a, b] = points;
    const requestId = ++nextRequestId.current;
    geodesicRequestIdRef.current = requestId;
    const message: GeodesicWorkerRequest = {
      type: "computeGeodesic",
      requestId,
      pointA: [a.x, a.y, a.z],
      pointB: [b.x, b.y, b.z],
    };
    worker.postMessage(message);
  }, [points, measurementMode, graphReadyToken]);

  useEffect(() => {
    setSurfaceDistance(draped?.distance ?? null);
  }, [draped, setSurfaceDistance]);

  return (
    <>
      {points.map((v, i) => {
        return (
          <mesh
            scale={0.01 * markerScale}
            key={i}
            position={v}
            geometry={MARKER_SPHERE_GEOMETRY}
            renderOrder={999}
          >
            <meshBasicMaterial color={"red"} depthTest={false} transparent />
          </mesh>
        );
      })}
      {points.length === 2 &&
        (measurementMode === "linear" ? (
          <Line
            points={points}
            color={"red"}
            depthTest={false}
            transparent
            renderOrder={999}
          />
        ) : (
          draped && (
            <Line
              points={draped.points}
              color="cyan"
              depthTest={false}
              transparent
              renderOrder={999}
              lineWidth={2}
            />
          )
        ))}
    </>
  );
};
