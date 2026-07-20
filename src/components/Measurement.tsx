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
import { getSplatCentersForGraph } from "../state/splatCentersGraphHolder";

type MeasurementProps = {
  modelRef: RefObject<Object3D | null>;
  modelUrl: string | null;
  // Increments once per newly-loaded mesh (see Model.tsx's onReady) -
  // needed alongside modelUrl, not instead of it: modelUrl changes at
  // selection time, before modelRef is actually attached (Model is
  // Suspense-based), so an effect keyed on modelUrl alone can run before
  // there's anything real to read from the ref, with nothing left to
  // trigger it a second time once the mesh actually finishes loading.
  meshReadyToken?: number;
  /**
   * Bumps once per newly-extracted splat-centers array (initial load, or
   * a manual "Refresh Measurement Data") - the actual Float32Array itself
   * is deliberately NOT passed as a prop, only this primitive counter.
   * See splatCentersGraphHolder.ts: React's dev-mode Components-track
   * instrumentation recursively walks every prop's own keys, and a
   * multi-million-element typed array reachable from props (even nested
   * inside a plain object or ref) measured as a multi-second main-thread
   * stall for a scene the size of stump.spz. Read the actual buffer via
   * getSplatCentersForGraph() instead.
   */
  splatCentersVersion?: number;
};

type DrapedResult = { points: Vector3[]; distance: number };

export const Measurement = ({
  modelRef,
  modelUrl,
  meshReadyToken,
  splatCentersVersion,
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
  // Tracks whether workerRef.current has a buildGraph/buildSplatGraph
  // request in flight - see ensureIdleWorker below.
  const buildInFlightRef = useRef(false);
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
        buildInFlightRef.current = false;
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
          buildInFlightRef.current = false;
          graphReadyRef.current = false;
        }
        if (data.requestId === geodesicRequestIdRef.current) {
          setDraped(null);
        }
      }
    };

    return worker;
  }, []);

  // Reuses workerRef.current when it's idle instead of unconditionally
  // terminating and recreating it on every mesh/splat load. A fresh
  // module Worker re-pays real cost every time - this one's module
  // imports three.js's BufferGeometryUtils plus the k-d tree/adjacency
  // code, so re-instantiating it is a genuine, measurable chunk of the
  // "onLoad finished but still stalled before buildSplatGraph fires" gap.
  // Termination is only actually needed to cancel a build that's
  // mid-flight - buildGraph/buildSplatGraph run as one synchronous call
  // inside the worker's onmessage handler, so nothing short of killing
  // the thread can interrupt one already running. If nothing is in
  // flight, there's no wasted CPU to reclaim, so the existing (already
  // warm) worker is reused as-is.
  const ensureIdleWorker = useCallback((): Worker => {
    if (workerRef.current && !buildInFlightRef.current) {
      return workerRef.current;
    }
    workerRef.current?.terminate();
    const worker = createGeodesicWorker();
    workerRef.current = worker;
    buildInFlightRef.current = false;
    return worker;
  }, [createGeodesicWorker]);

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

  // Rebuild the MESH graph when the model changes OR when a mesh finishes
  // loading. Depends on BOTH modelUrl and meshReadyToken, not modelUrl
  // alone - modelUrl changes at selection time, immediately, but
  // modelRef.current only becomes valid later, once Model's Suspense
  // boundary actually resolves and its <primitive ref={ref}> mounts.
  // An effect keyed on modelUrl alone fires too early (modelRef.current
  // is still null or stale), and nothing was left to trigger it again
  // once the ref actually caught up - this was a real, confirmed bug,
  // not a hypothetical: switching from a splat to a mesh (or between two
  // meshes) while depending on modelUrl alone meant the mesh graph build
  // simply never started, silently. meshReadyToken (see Model.tsx's
  // onReady) is what closes that gap - it fires unconditionally once per
  // newly-loaded mesh, specifically once the ref is real.
  //
  // In splat mode modelRef.current is always null (Model never mounts,
  // meshReadyToken never increments), so this naturally no-ops and
  // defers to the splat-graph effect below.
  useEffect(() => {
    // Same reasoning as the splat graph effect below: buildGraph (mesh
    // welding + adjacency) runs as one synchronous call inside the
    // worker's onmessage handler, so a stale build from a previously
    // selected mesh needs the thread killed outright to actually stop -
    // the requestId check further down only discards its eventual
    // result, it doesn't reclaim the CPU time already being spent on it
    // (see ensureIdleWorker). Always resets buildingGraph regardless, so
    // it reliably gets reset to false on every transition, not just the
    // successful ones - buildingGraph is shared state between this effect
    // and the splat one, so a stuck-true here could just as easily break
    // the splat path's toast as the reverse.
    const freshWorker = ensureIdleWorker();

    graphReadyRef.current = false;
    setDraped(null);
    setBuildingGraph(false);

    if (!modelRef.current) {
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
      return;
    }

    const requestId = ++nextRequestId.current;
    graphRequestIdRef.current = requestId;

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

    // Deferred one frame for the same reason as the splat graph effect:
    // calling setBuildingGraph(true) synchronously right after the false
    // above would let React 18's batching collapse them into a single
    // "no net change" update whenever buildingGraph was already true
    // entering this effect (e.g. a splat's graph was still building when
    // the user switched to a mesh) - the toast would silently not
    // re-fire, same root cause as the splat-side bug, just reachable
    // from the mesh side too since they share the same flag.
    //
    // Cancelled on cleanup, not left to fire unconditionally - without
    // this, an effect re-run (a rapid model switch, or React StrictMode's
    // deliberate double-invoke on every mount in dev) could leave this
    // callback pending and have it fire later, calling
    // setBuildingGraph(true) from an already-stale run's closure with no
    // relation to whatever's actually selected by the time it runs. That
    // orphaned call is exactly what could show the toast even when the
    // CURRENT model's own build was never actually reached.
    const rafId = requestAnimationFrame(() => {
      setBuildingGraph(true);
      buildInFlightRef.current = true;
      freshWorker.postMessage(message, transfer);
    });
    return () => cancelAnimationFrame(rafId);
  }, [modelUrl, meshReadyToken, ensureIdleWorker]);

  // Rebuild the SPLAT graph whenever a new splat-centers array arrives -
  // keyed on splatCentersVersion, a primitive counter that bumps exactly
  // once per successful splat load (see extractSparkSplatCenters /
  // handleSparkSplatLoad), same reasoning as keying on splatMesh identity
  // used to have. Extraction/world-space transform already happened
  // upstream - this effect doesn't know or care which splat library
  // produced the array. The actual buffer is read via
  // getSplatCentersForGraph(), not a prop - see splatCentersGraphHolder.ts.
  useEffect(() => {
    // Cancels an in-flight build and replaces the worker, on every
    // version bump - including the transition to 0/undefined while
    // switching models, not just when new real centers arrive (see
    // ensureIdleWorker). buildSplatGraph runs as one synchronous call
    // inside the worker's onmessage handler - once started, nothing can
    // interrupt it short of killing the thread, so a stale build from a
    // previous splat (real wasted CPU, often for the entire multi-second
    // gap between "model changed" and "new splat's centers are ready")
    // needs to actually be cancelled, not just have its eventual result
    // discarded. If nothing is in flight, ensureIdleWorker reuses the
    // existing worker instead - avoids re-paying that worker's own
    // module-compile cost (three.js's BufferGeometryUtils + the k-d tree
    // code) on every single load, which was itself a real contributor to
    // the gap between the splat becoming visible and buildSplatGraph
    // actually being posted.
    const freshWorker = ensureIdleWorker();

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

    const splatCenters = getSplatCentersForGraph();
    if (!splatCentersVersion || !splatCenters || splatCenters.length === 0) {
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
    //
    // Copies splatCenters rather than posting it directly, so the
    // buffer that actually gets transferred (and detached) belongs to
    // THIS message alone - splatCenters itself lives in the shared
    // module-level holder (also read by App.tsx's floater cleanup
    // feature), not something exclusively owned by this effect.
    // Transferring the shared reference directly - which this used to
    // do - detaches its buffer out from under every other consumer of
    // that same state the moment this effect runs, permanently, for the
    // rest of that splat's lifetime: a real, confirmed bug (empty-looking
    // Float32Array with byteLength: 0 wherever splatCenters was read
    // afterward), not a hypothetical. The copy itself is cheap - a raw
    // array copy, not the expensive per-splat decode loop the original
    // transfer-instead-of-clone change was actually targeting.
    const centersForWorker = new Float32Array(splatCenters);
    const message: GeodesicWorkerRequest = {
      type: "buildSplatGraph",
      requestId,
      centers: centersForWorker,
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
    //
    // Cancelled on cleanup for the same reason as the mesh graph effect:
    // an uncancelled callback left pending across an effect re-run (a
    // rapid model switch, or StrictMode's double-invoke on mount) can
    // fire later and call setBuildingGraph(true) from an already-stale
    // closure, showing the toast for a build that has nothing to do with
    // whatever's actually selected by then.
    const rafId = requestAnimationFrame(() => {
      setBuildingGraph(true);
      buildInFlightRef.current = true;
      freshWorker.postMessage(message, [centersForWorker.buffer]);
    });
    return () => cancelAnimationFrame(rafId);
  }, [splatCentersVersion, ensureIdleWorker]);

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
