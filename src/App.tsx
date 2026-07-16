import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Model, type ModelFieldInfo } from "./components/Model";
import {
  Environment,
  CameraControls,
  Grid,
  TransformControls,
  useGLTF,
  GizmoHelper,
  GizmoViewport,
  Stats,
} from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";
import { useViewer } from "./state/state";
import { useMeasurement } from "./state/measurementState";
import { Measurement } from "./components/Measurement";
import { Annotations } from "./components/Annotations";
import { Sidebar } from "./ui/Sidebar";
import { SplatTransformPanel } from "./ui/SplatTransformPanel";
import {
  SplatLoadProgress,
  type SplatLoadProgressValue,
} from "./ui/splat/SplatLoadProgress";
import type { Annotation } from "./state/state";
import { Box3, Mesh, MathUtils, type Group } from "three";
import {
  FieldContext,
  StreamlineField,
  type FieldContextValue,
} from "./components/Aero_Vis/StreamlineField";
import {
  directionFromYawPitch,
  orthonormalBasis,
} from "./utils/aerodynamics_utils";
import { Toolbar } from "./ui/Toolbar";
import { useAero } from "./state/aeroState";
import { TextureEdit } from "./ui/TextureEdit";
import { registerRenderer } from "./utils/texturePaint";
import { MeshDeformation } from "./components/Mesh_Deform/MeshDeformation";
import { SparkScene } from "./components/spark_Splat/SparkScene";
import { SparkSplat } from "./components/spark_Splat/SparkSplat";
import type { PackedSplats, SplatMesh } from "@sparkjsdev/spark";
import {
  handleSparkSplatLoad,
  handleSparkSplatClick,
  analyzeSparkSplatFloaters,
  applySparkFloaterThreshold,
  type FloaterAnalysis,
  revertSparkFloaterAnalysis,
} from "./utils/spark_Splat/utils";
import { FloaterCleanupPanel } from "./ui/splat/FloaterCleanupPanel";
import { ToastNotification } from "./ui/ToastNotification";

// Module-level, not inline in JSX - a plain [80, 80]/["red","green","blue"]
// written directly in JSX creates a brand-new array on every single App
// render. Confirmed via trace as a real cause of a "Cascading Update"
// loop inside GizmoHelper/GizmoViewport - the same bug class already
// root-caused twice this session for onLoad/onError/onSplatClick, just
// surfacing through a different component this time. Stable references
// here mean drei's internals see the "same" props across renders, same
// as they always should have.
const GIZMO_MARGIN: [number, number] = [80, 80];
const GIZMO_AXIS_COLORS: [string, string, string] = ["red", "green", "blue"];
// A moderate starting point (score 1.0 = typical local density, higher
// is sparser) - untested against a real, noisy capture, so treat this as
// a reasonable first guess rather than a validated default. Likely needs
// tuning once tried against real data.
const DEFAULT_FLOATER_THRESHOLD = 1.5;

type CameraFocusParams = {
  cameraControlsRef: RefObject<CameraControls | null>;
  focused: Annotation | null;
  focusedId: string | null;
  resetCameraPos: boolean;
  resetCallback: () => void;
};

const CameraFocus = ({
  cameraControlsRef,
  focused,
  focusedId,
  resetCameraPos,
  resetCallback,
}: CameraFocusParams) => {
  const markerScale = useViewer((s) => s.markerScale);
  useEffect(() => {
    if (!cameraControlsRef.current) return;
    if (focused) {
      const dist = 0.25 * markerScale;
      const [px, py, pz] = focused.position;
      const [nx, ny, nz] = focused.normal ?? [0, 0, 1];
      const camX = px + nx * dist;
      const camY = py + ny * dist;
      const camZ = pz + nz * dist;
      cameraControlsRef.current.setLookAt(camX, camY, camZ, px, py, pz, true);
    } else {
      cameraControlsRef.current.reset(true);
    }
  }, [focusedId]);

  useEffect(() => {
    if (!cameraControlsRef.current) return;
    if (resetCameraPos)
      cameraControlsRef.current.reset(true).then(() => {
        resetCallback();
      });
  }, [resetCameraPos]);

  return null;
};

function FrameOnLoad({
  controlsRef,
  modelRef,
  modelUrl,
}: {
  controlsRef: RefObject<CameraControls | null>;
  modelRef: RefObject<Group | null>;
  modelUrl: string | null;
}) {
  const setMarkerScale = useViewer((s) => s.setMarkerScale);
  const clearPoints = useMeasurement((s) => s.clearPoints);
  useEffect(() => {
    if (!controlsRef.current || !modelRef.current) return;
    controlsRef.current.reset(false);
    const box = new Box3().setFromObject(modelRef.current);
    const markerScale = box.max.x - box.min.x;
    setMarkerScale(markerScale);
    clearPoints();
    controlsRef.current.fitToBox(box, false);
    controlsRef.current.saveState();
  }, [modelUrl]);
  return null;
}

function InvalidateBridge() {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const setRequestRender = useViewer((s) => s.setRequestRender);
  useEffect(() => {
    setRequestRender(invalidate);
  }, [invalidate, setRequestRender]);
  useEffect(() => {
    registerRenderer(gl);
  }, [gl]);
  return null;
}

function App() {
  const annotations = useViewer((s) => s.annotations);
  const focusedId = useViewer((s) => s.focusedId);
  const isWireframe = useViewer((s) => s.isWireframe);
  const showAero = useViewer((s) => s.showAero);
  const showTransformControls = useViewer((s) => s.showTransformControls);
  const transformControlsMode = useViewer((s) => s.transformControlsMode);
  const models = useViewer((s) => s.models);
  const modelUrl = useViewer((s) => s.modelUrl);
  const setResetCamera = useViewer((s) => s.setResetCamera);
  const pruneUploadedAnnotations = useViewer((s) => s.pruneUploadedAnnotations);
  const setShowTransformControls = useViewer((s) => s.setShowTransformControls);
  const setMeshDeformation = useViewer((s) => s.setMeshDeformation);

  const resetCamera = useViewer((s) => s.resetCamera);
  const uploadedModelUrl = useViewer((s) => s.uploadedModelUrl);
  const cameraControlsRef = useRef<CameraControls | null>(null);
  const modelRef = useRef<Group | null>(null);
  const splatRef = useRef<SplatMesh | null>(null);
  const prevModelFieldRef = useRef<ModelFieldInfo | null>(null);
  const config = useAero((s) => s.config);
  const meshDeformation = useViewer((s) => s.meshDeformation);
  const clearPoints = useMeasurement((s) => s.clearPoints);
  const addPoint = useMeasurement((s) => s.addPoint);
  const addAnnotation = useViewer((s) => s.addAnnotation);
  const setMarkerScale = useViewer((s) => s.setMarkerScale);
  const tool = useViewer((s) => s.tool);

  const focused = annotations.find((a) => a.id === focusedId) ?? null;
  const effectiveModelUrl = uploadedModelUrl ?? modelUrl;

  const selectedModel = models.find((m) => m.modelUrl === modelUrl);
  const isSplatModel = !uploadedModelUrl && selectedModel?.kind === "splat";
  const activeObjectRef = isSplatModel ? splatRef : modelRef;

  const [modelField, setModelField] = useState<ModelFieldInfo | null>(null);
  // Increments once per newly-loaded mesh, via Model's onReady - the
  // signal Measurement.tsx's mesh graph effect actually needs, since
  // modelUrl changes before Suspense resolves and modelRef.current is
  // real. Without this, Measurement had no way to know when to retry
  // after its first (too-early) attempt.
  const [meshReadyToken, setMeshReadyToken] = useState(0);
  const handleMeshReady = useCallback(() => {
    setMeshReadyToken((t) => t + 1);
  }, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [loadedSplatMesh, setLoadedSplatMesh] = useState<SplatMesh | null>(
    null,
  );
  const [splatCenters, setSplatCenters] = useState<Float32Array | null>(null);
  // Mirrors splatCenters state - exists specifically so handleSplatClick
  // can read the current value at call time without needing splatCenters
  // in its own useCallback dependency array (a ref's identity is stable,
  // so including it wouldn't even reliably trigger recreation on mutation
  // anyway - state remains the correct mechanism for anything that needs
  // to actually react to the value changing, like Measurement's
  // graph-rebuild effect below).
  const splatCentersRef = useRef<Float32Array | null>(null);

  // Floater cleanup - analysis is opt-in (explicit button, not run on
  // every load) since it's a real, non-trivial worker pass; the
  // threshold itself is meant to feel live once analysis is done, hence
  // the separate DEFAULT_FLOATER_THRESHOLD constant rather than deriving
  // one from the data - a data-derived default would need the analysis
  // to already be done to compute it, which defeats "opt-in".
  const [floaterAnalysis, setFloaterAnalysis] =
    useState<FloaterAnalysis | null>(null);
  const [isAnalyzingFloaters, setIsAnalyzingFloaters] = useState(false);
  const [floaterThreshold, setFloaterThreshold] = useState(
    DEFAULT_FLOATER_THRESHOLD,
  );
  const [hiddenFloaterCount, setHiddenFloaterCount] = useState(0);

  const [splatTransformDisplay, setSplatTransformDisplay] = useState<{
    position: [number, number, number];
    rotationDeg: [number, number, number];
  } | null>(null);
  const [splatProgress, setSplatProgress] =
    useState<SplatLoadProgressValue | null>(null);
  // Tracks the gap between the splat becoming visible and the
  // main-thread work setSplatCenters triggers actually finishing (a
  // "Cascading Update" confirmed via trace analysis, currently still
  // unresolved despite fixing GizmoHelper's unstable array props - this
  // doesn't make that work any faster, it's a detection mechanism so the
  // UI can at least show something during it instead of silently
  // freezing with no explanation).

  // Stable (empty deps) - required, not a style choice: this gets passed
  // as SparkSplat's onProgress prop, which sits in that component's
  // loading effect's dependency array. An unstable reference here would
  // tear down and restart the load on every App render, the same bug
  // class already root-caused twice this session for onLoad/onClick.
  const handleSplatProgress = useCallback((event: ProgressEvent) => {
    setSplatProgress({
      loaded: event.loaded,
      total: event.total,
      lengthComputable: event.lengthComputable,
    });
  }, []);

  // Reads the live transform straight off the Object3D rather than any
  // React state - TransformControls' gizmo mutates position/rotation
  // directly (imperatively), so this is the only source of truth for
  // "what is it right now", not something React already knows.
  // Accepts an explicit object (bypassing splatRef entirely) for the
  // load-time call - splatRef.current isn't reliably attached yet at that
  // point, since <Canvas> runs on R3F's own separate reconciler from the
  // DOM-based root App renders on, and there's no cross-reconciler
  // guarantee that R3F's ref attachment has committed before this
  // component's own effects run. Falls back to splatRef.current for the
  // onObjectChange (drag) case, where the object is already known-live.
  const readSplatTransform = useCallback((obj?: SplatMesh | null) => {
    const target = obj ?? splatRef.current;
    if (!target) {
      setSplatTransformDisplay(null);
      return;
    }
    setSplatTransformDisplay({
      position: [target.position.x, target.position.y, target.position.z],
      rotationDeg: [
        MathUtils.radToDeg(target.rotation.x),
        MathUtils.radToDeg(target.rotation.y),
        MathUtils.radToDeg(target.rotation.z),
      ],
    });
  }, []);

  const handleSplatPositionEdit = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      const obj = splatRef.current;
      if (!obj) return;
      if (axis === 0) obj.position.x = value;
      else if (axis === 1) obj.position.y = value;
      else obj.position.z = value;
      obj.updateMatrixWorld(true);
      readSplatTransform();
    },
    [readSplatTransform],
  );

  const handleSplatRotationEdit = useCallback(
    (axis: 0 | 1 | 2, degrees: number) => {
      const obj = splatRef.current;
      if (!obj) return;
      const rad = MathUtils.degToRad(degrees);
      if (axis === 0) obj.rotation.x = rad;
      else if (axis === 1) obj.rotation.y = rad;
      else obj.rotation.z = rad;
      obj.updateMatrixWorld(true);
      readSplatTransform();
    },
    [readSplatTransform],
  );
  const handleField = useCallback((f: ModelFieldInfo) => setModelField(f), []);

  const handleRetry = useCallback(() => {
    // useGLTF/useLoader cache rejected loads too, so just resetting the
    // error boundary would replay the exact same cached failure instantly
    // instead of actually retrying the request - evict it first so the
    // remounted <Model> genuinely re-fetches.
    if (effectiveModelUrl) useGLTF.clear(effectiveModelUrl);
    setErrorMessage(null);
    setRetryToken((t) => t + 1);
  }, [effectiveModelUrl]);

  // setErrorMessage is a useState setter - React guarantees its identity
  // never changes across renders, so wrapping it here keeps this callback
  // just as stable as the old module-level logSparkSplatError was. That
  // stability is load-bearing, not a style choice: SparkSplat's loading
  // effect has `onError` in its dependency array, so an unstable
  // reference here would make that effect tear down and re-run on every
  // App render - the exact reload-loop bug already root-caused twice
  // earlier this session for onLoad and onSplatClick.
  const handleSplatError = useCallback((err: unknown) => {
    setErrorMessage(err instanceof Error ? err.message : String(err));
    setSplatProgress(null);
  }, []);
  const flowDirection = useMemo(
    () => directionFromYawPitch(config.flowYawDeg, config.flowPitchDeg),
    [config.flowYawDeg, config.flowPitchDeg],
  );
  const { right, up } = useMemo(
    () => orthonormalBasis(flowDirection),
    [flowDirection],
  );

  const enrichedField: FieldContextValue | null = useMemo(() => {
    if (!modelField) return null;
    return { ...modelField, flowDirection, right, up };
  }, [modelField, flowDirection, right, up]);

  useEffect(() => {
    setModelField(null);
    setShowTransformControls(false);
    setMeshDeformation(false);
    setErrorMessage(null);
    setLoadedSplatMesh(null);
    setSplatCenters(null);
    splatCentersRef.current = null;
    setFloaterAnalysis(null);
    setIsAnalyzingFloaters(false);
    setFloaterThreshold(DEFAULT_FLOATER_THRESHOLD);
    setHiddenFloaterCount(0);
    setSplatTransformDisplay(null);
    setSplatProgress(null);
  }, [effectiveModelUrl]);

  // Reads the transform once a splat finishes loading (and, for interior
  // mode, once detectOrientationFromSamples has already been applied to
  // it inside handleSparkSplatLoad) - without this, the panel would show
  // stale/empty values until the user first touched the gizmo.
  // splatTransformDisplay is populated directly inside handleSplatLoad
  // below, using the SplatMesh parameter it already receives - not via a
  // separate effect reading splatRef.current, which isn't reliably
  // attached yet at load time (see readSplatTransform's comment).

  useEffect(() => {
    const prev = prevModelFieldRef.current;
    if (prev && prev !== modelField) {
      prev.collisionGeometry?.dispose();
    }
    prevModelFieldRef.current = modelField;
  }, [modelField]);

  // Thin wrapper: actual logic lives in sparkSplat_utils.ts as a plain
  // function (useCallback can't be called at module scope), this just
  // closes over the current App-level state/refs and forwards them in.
  const handleSplatLoad = useCallback(
    (splatMesh: SplatMesh) => {
      handleSparkSplatLoad(splatMesh, {
        cameraControlsRef,
        selectedModel,
        setMarkerScale,
        clearPoints,
        setLoadedSplatMesh,
        applySplatCenters: (forState, forClicks) => {
          splatCentersRef.current = forClicks;
          // Yield one frame before triggering the actual update - without
          // this, setSplatCenters below could get batched into the very
          // same blocking render pass as setIsPreparingSplatData itself,
          // meaning the "preparing" indicator would never get a chance
          // to actually paint before the freeze begins.
          requestAnimationFrame(() => {
            setSplatCenters(forState);
            // Queued behind whatever setSplatCenters ends up triggering,
            // however long that turns out to be - a callback scheduled
            // here genuinely cannot run until the main thread is free
            // again, since JS is single-threaded and this is queued
            // behind the current blocking work. That's the actual
            // detection mechanism: not a timer or a guess, just relying
            // on the browser's own scheduling guarantee. This doesn't
            // make the underlying cascade any faster.
            requestAnimationFrame(() => {
              setSplatProgress(null);
            });
          });
        },
        splatRef,
      });
      // Uses the splatMesh parameter directly rather than splatRef.current -
      // see readSplatTransform's comment for why the ref isn't reliable yet
      // at this exact point.
      readSplatTransform(splatMesh);
    },
    [selectedModel, setMarkerScale, clearPoints, readSplatTransform],
  );

  const handleSplatClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!splatRef.current) return;
      handleSparkSplatClick(event, splatRef.current, {
        tool,
        addPoint,
        addAnnotation,
        effectiveModelUrl,
        splatCentersRef,
      });
    },
    [tool, addPoint, addAnnotation, effectiveModelUrl],
  );

  // Reuses splatCenters (already extracted for the geodesic feature)
  // rather than re-decoding centers from scratch - see
  // analyzeSparkSplatFloaters's own comment for why. Requires splatCenters
  // to already be populated, which is why the panel gates its "Analyze"
  // button on that rather than just on a splat being loaded at all.
  const handleAnalyzeFloaters = useCallback(async () => {
    if (!splatRef.current || !splatCenters || splatCenters.length === 0) return;
    const targetSplat = splatRef.current;
    setIsAnalyzingFloaters(true);
    try {
      const result = await analyzeSparkSplatFloaters(targetSplat, splatCenters);
      // Staleness guard, same reasoning as handleSparkSplatLoad's - if
      // the user switched models while this was running, applying the
      // result now would silently corrupt whatever's actually loaded.
      if (splatRef.current !== targetSplat) return;
      setFloaterAnalysis(result);
      const hidden = applySparkFloaterThreshold(
        targetSplat,
        result,
        floaterThreshold,
      );
      setHiddenFloaterCount(hidden);
    } catch (error) {
      console.error("Floater analysis failed:", error);
    } finally {
      setIsAnalyzingFloaters(false);
    }
  }, [splatCenters, floaterThreshold]);

  const handleFloaterThresholdChange = useCallback(
    (threshold: number) => {
      setFloaterThreshold(threshold);
      if (!splatRef.current || !floaterAnalysis) return;
      const hidden = applySparkFloaterThreshold(
        splatRef.current,
        floaterAnalysis,
        threshold,
      );
      setHiddenFloaterCount(hidden);
    },
    [floaterAnalysis],
  );

  const handleRevertFloaters = useCallback(() => {
    if (!splatRef.current) return;

    // Revert the physical mesh data and re-enable LOD
    revertSparkFloaterAnalysis(splatRef.current, floaterAnalysis);

    // Clear your React state trackers
    setFloaterAnalysis(null);
    setHiddenFloaterCount(0);
  }, [floaterAnalysis]);

  useEffect(() => {
    pruneUploadedAnnotations();
  }, [pruneUploadedAnnotations]);

  useEffect(() => {
    if (modelRef.current) {
      modelRef.current.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const mat of mats) {
          mat.wireframe = isWireframe;
        }
      });
    }
  }, [isWireframe]);

  return (
    <>
      <div
        className="fixed top-2 left-2 right-2 z-10 flex flex-col items-stretch gap-2
             max-h-[calc(100vh-1rem)] md:top-4 md:left-4 md:right-auto md:w-auto md:max-h-[calc(100vh-2rem)]"
      >
        <Toolbar modelRef={modelRef} />
        {!isSplatModel && (
          <TextureEdit modelRef={modelRef} modelUrl={effectiveModelUrl} />
        )}
        {isSplatModel && showTransformControls && splatTransformDisplay && (
          <SplatTransformPanel
            position={splatTransformDisplay.position}
            rotationDeg={splatTransformDisplay.rotationDeg}
            onPositionChange={handleSplatPositionEdit}
            onRotationChange={handleSplatRotationEdit}
          />
        )}
        {isSplatModel && splatCenters && splatCenters.length > 0 && (
          <FloaterCleanupPanel
            isAnalyzing={isAnalyzingFloaters}
            analysisReady={floaterAnalysis !== null}
            hiddenCount={hiddenFloaterCount}
            totalCount={floaterAnalysis?.scores.length ?? 0}
            threshold={floaterThreshold}
            onAnalyze={handleAnalyzeFloaters}
            onThresholdChange={handleFloaterThresholdChange}
            onRevert={handleRevertFloaters}
          />
        )}
      </div>
      {errorMessage && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-black/80 p-4 text-center text-white backdrop-blur break-words">
            <h1 className="text-lg font-semibold md:text-xl">{errorMessage}</h1>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-4 rounded bg-white/10 px-5 py-2.5 hover:bg-white/20 active:bg-white/30"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      <ToastNotification url={effectiveModelUrl} />
      {isSplatModel ? (
        <SplatLoadProgress progress={splatProgress} />
      ) : (
        <Loader />
      )}
      <Sidebar />
      <Canvas
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
        camera={{ near: 0.001, far: 1000 }}
        // R3F defaults antialias to true (unlike vanilla Three.js's own
        // false default) - Spark's own source explicitly documents this
        // as a meaningful performance cost specific to Gaussian splat
        // rendering with no visual benefit for it, confirmed as a real
        // GPU-side bottleneck by a performance trace on this app.
        gl={{ antialias: isSplatModel ? false : true }}
        frameloop={isSplatModel ? "always" : "demand"}
        dpr={[1, 2]}
      >
        <Stats />
        <GizmoHelper
          alignment="bottom-right" // widget alignment within scene
          margin={GIZMO_MARGIN} // widget margins (X, Y)
        >
          <GizmoViewport axisColors={GIZMO_AXIS_COLORS} labelColor="white" />
        </GizmoHelper>
        <CameraControls ref={cameraControlsRef} makeDefault />
        <InvalidateBridge />

        {isSplatModel && effectiveModelUrl && (
          <>
            <SparkScene />
            <SparkSplat
              key={`${effectiveModelUrl}-${retryToken}`}
              ref={splatRef}
              url={effectiveModelUrl}
              onLoad={handleSplatLoad}
              onError={handleSplatError}
              onProgress={handleSplatProgress}
              onClick={handleSplatClick}
            />
          </>
        )}

        <ErrorBoundary
          fallback={null} // or a fallback mesh, e.g. <group /> or a placeholder <mesh>
          onError={(error) => {
            setErrorMessage((error as Error).message);
          }}
          resetKeys={[retryToken]}
        >
          {!isSplatModel && meshDeformation && modelRef.current && (
            <MeshDeformation object={modelRef.current} renderObject={false} />
          )}
          <Suspense fallback={null}>
            {!isSplatModel && effectiveModelUrl && (
              <Model
                ref={modelRef}
                url={effectiveModelUrl}
                onField={handleField}
                onReady={handleMeshReady}
              />
            )}
            {showTransformControls && effectiveModelUrl && (
              <TransformControls
                object={activeObjectRef as RefObject<Group>}
                mode={transformControlsMode}
                onObjectChange={() => readSplatTransform()}
              />
            )}
            <CameraFocus
              resetCallback={() => setResetCamera(false)}
              cameraControlsRef={cameraControlsRef}
              focused={focused}
              focusedId={focusedId}
              resetCameraPos={resetCamera}
            />
            <Annotations />
            <Measurement
              modelRef={modelRef}
              modelUrl={effectiveModelUrl}
              meshReadyToken={meshReadyToken}
              splatCenters={splatCenters}
            />
            {!isSplatModel && (
              <>
                <FrameOnLoad
                  controlsRef={cameraControlsRef}
                  modelRef={modelRef}
                  modelUrl={effectiveModelUrl}
                />
                <Environment preset="city" />
              </>
            )}
          </Suspense>
        </ErrorBoundary>

        {!isSplatModel && showAero && enrichedField && modelField && (
          <FieldContext.Provider value={enrichedField}>
            <StreamlineField
              count={config.streamlineCount}
              freestreamSpeed={modelField.maxRadius}
              trailLength={config.trailLength}
              colorBySpeed={config.colorBySpeed}
              surfaceInfluence={modelField.maxRadius * 0.15}
              repulsionStrength={config.repulsionStrength}
            />
          </FieldContext.Provider>
        )}
        <Grid infiniteGrid fadeDistance={50} />
      </Canvas>
    </>
  );
}

export default App;
