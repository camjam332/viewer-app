import { Line } from "@react-three/drei";
import { useMeasurement } from "../state/measurementState";
import { useViewer } from "../state/state";
import { BufferAttribute, Mesh, Object3D, Vector3 } from "three";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
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
  const setBuildingGraph = useMeasurement((s) => s.setBuildingGraph);

  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  const graphRequestIdRef = useRef<number | null>(null);
  const geodesicRequestIdRef = useRef<number | null>(null);
  const graphReadyRef = useRef(false);
  const [graphReadyToken, setGraphReadyToken] = useState(0);
  const [draped, setDraped] = useState<DrapedResult | null>(null);

  // Extracted so it can be called both at mount and whenever an
  // in-flight worker needs to be replaced (see the splat-graph effect
  // below) - not just for DRY's sake, this is what makes "cancel" mean
  // something. Stable across renders: everything it closes over
  // (setBuildingGraph/setSurfaceDistance are Zustand setters, the refs
  // are refs, setGraphReadyToken/setDraped are useState setters) is
  // guaranteed stable identity already, so an empty dependency array is
  // correct here, not just convenient.
  const createGeodesicWorker = useCallback((): Worker => {
    const worker = new Worker(
      new URL("../workers/geodesicWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<GeodesicWorkerResponse>) => {
      const data = event.data;
      console.log(data.type);
      if (data.type === "graphReady") {
        if (data.requestId !== graphRequestIdRef.current) return; // stale
        setBuildingGraph(false);
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

    return worker;
  }, []);

  // The graph build (weld + adjacency, or k-d tree + kNN graph) and the
  // Dijkstra search are both O(vertex/splat count) or worse, which freezes
  // the main thread on dense meshes or large splat clouds. Offload them to
  // a worker so the UI stays responsive.
  useEffect(() => {
    workerRef.current = createGeodesicWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createGeodesicWorker]);

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
    setBuildingGraph(true);
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
    // Terminate and replace unconditionally, on every splatCenters
    // change - including the transition to null while switching models,
    // not just when new real centers arrive. buildSplatGraph runs as one
    // synchronous call inside the worker's onmessage handler - once
    // started, nothing can interrupt it short of killing the thread.
    // Previously this only happened in the "have new centers" branch,
    // which left a stale build running (real wasted CPU) for the entire
    // gap between "model changed" and "new splat's centers are ready" -
    // often several seconds - and left buildingGraph stuck at true for
    // that whole window too.
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    const freshWorker = createGeodesicWorker();
    workerRef.current = freshWorker;

    graphReadyRef.current = false;
    setDraped(null);

    // Setting this unconditionally, before checking whether there's
    // actually new data to build - a splat B loaded while A's build was
    // still in flight would otherwise call setBuildingGraph(true) while
    // it was ALREADY true (never having been reset during the null gap
    // above), which React sees as no change at all (true -> true bails
    // out, no re-render) - exactly why ToastNotification's own
    // buildingGraph-keyed effect was silently not re-firing for B.
    setBuildingGraph(false);

    if (!splatCenters || splatCenters.length === 0) {
      return;
    }

    const requestId = ++nextRequestId.current;
    graphRequestIdRef.current = requestId;

    // Safe to transfer now - splatCenters here is a buffer produced
    // specifically for this effect's use (see splatCenters.worker.ts and
    // App.tsx's applySplatCenters), independent from the separate copy
    // splatCentersRef holds for click-based normal estimation. This used
    // to be a genuine, measurable main-thread structured-clone cost -
    // confirmed via the "splat renders, orbits briefly, then the main
    // thread pauses" symptom this was root-caused from, since this
    // effect fires exactly when the async center-extraction resolves,
    // sometime after the splat is already visible and interactive.
    const message: GeodesicWorkerRequest = {
      type: "buildSplatGraph",
      requestId,
      centers: splatCenters,
      k: 8,
    };
    console.log(message.type);

    // Deferred one frame, not called synchronously right after
    // setBuildingGraph(false) above - React 18's automatic batching
    // would otherwise collapse a false-then-true within the same
    // synchronous pass into a single "no net change" update whenever
    // buildingGraph was already true entering this effect (exactly the
    // A-still-building, B-just-arrived case this whole fix is for).
    // Yielding one frame first forces the false to commit as its own,
    // separate, observable render before the true that follows it.
    requestAnimationFrame(() => {
      setBuildingGraph(true);
      freshWorker.postMessage(message, [splatCenters.buffer]);
    });
  }, [splatCenters, createGeodesicWorker]);

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
