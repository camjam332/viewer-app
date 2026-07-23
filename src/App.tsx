import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { Model, type ModelFieldInfo } from "./components/Model";
import {
  Environment,
  CameraControls,
  Grid,
  TransformControls,
  useGLTF,
  GizmoHelper,
  GizmoViewport,
} from "@react-three/drei";
import { SparkFlyControls } from "./components/SparkFlyControls";
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
import {
  getSplatCentersForGraph,
  setSplatCentersForGraph,
} from "./state/splatCentersGraphHolder";
import { Annotations } from "./components/Annotations";
import { Sidebar } from "./ui/Sidebar";
import { SplatTransformPanel } from "./ui/SplatTransformPanel";
import {
  SplatLoadProgress,
  type SplatLoadProgressValue,
} from "./ui/splat/SplatLoadProgress";
import { Mesh, MathUtils, type Group, DoubleSide } from "three";
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
import { MeshDeformation } from "./components/Mesh_Deform/MeshDeformation";
import { SparkScene } from "./components/spark_Splat/SparkScene";
import { SparkSplat } from "./components/spark_Splat/SparkSplat";
import type { SplatMesh } from "@sparkjsdev/spark";
import type { UploadKind } from "./utils/uploadFileType";
import {
  handleSparkSplatLoad,
  handleSparkSplatClick,
  analyzeSparkSplatFloaters,
  applySparkFloaterThreshold,
  revertSparkFloaterAnalysis,
  extractSparkSplatCentersAsync,
  type FloaterAnalysis,
} from "./utils/spark_Splat/utils";
import { FloaterCleanupPanel } from "./ui/splat/FloaterCleanupPanel";
import { StaleMeasurementDataWarning } from "./ui/splat/StaleMeasurementDataWarning";
import { ToastNotification } from "./ui/ToastNotification";
import { CameraFocus } from "./components/CameraFocus";
import { FrameOnLoad } from "./components/FrameOnLoad";
import { InvalidateBridge } from "./components/InvalidateBridge";
import { ModelSwitchConfirmDialog } from "./ui/ModelSwitchConfirmDialog";
import { createSparkBreatheModifier } from "./utils/spark_Splat/breatheModifier";
// What a requested model change actually is, regardless of which UI path
// triggered it (picking from the list vs. uploading a new file) - kept
// as a single shape so requestModelChange/applyModelChange don't need to
// branch on "how did we get called", only on "is this an upload".
type PendingModelChange = {
  url: string;
  isUpload: boolean;
  // Only set (and only meaningful) when isUpload is true - the picker's
  // own models already carry `kind` on their ModelOption entry.
  upload?: UploadKind;
};

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

// Shared shape between the live display (splatTransformDisplay) and the
// baseline captured whenever splatCenters is last extracted
// (splatCentersExtractedAtTransform) - a pure function, not a hook, so
// both readSplatTransform (updates React state) and the baseline-capture
// call sites (inside applySplatCenters / handleRefreshSplatMeasurementData)
// can use the exact same snapshot logic without duplicating it.
type SplatTransformSnapshot = {
  position: [number, number, number];
  rotationDeg: [number, number, number];
};
function getSplatTransformSnapshot(obj: SplatMesh): SplatTransformSnapshot {
  return {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotationDeg: [
      MathUtils.radToDeg(obj.rotation.x),
      MathUtils.radToDeg(obj.rotation.y),
      MathUtils.radToDeg(obj.rotation.z),
    ],
  };
}

// A moderate starting point (component size / total splat count) - real
// floater clusters should be a tiny fraction of the whole scene, while
// the dominant mass should sit close to 1.0. Untested against a real,
// noisy capture, so treat this as a reasonable first guess rather than
// a validated default. Likely needs tuning once tried against real
// data - see floaterDetection.worker.ts's own comments for the same
// caveat on the connectivity radius this depends on.
const DEFAULT_FLOATER_THRESHOLD = 0.01;
// How generous the connectivity graph's per-connection local radius is -
// see floaterDetection.worker.ts for the full reasoning. Confirmed via
// real testing that this genuinely needs to vary by scene (a dense
// object scan and a sparse room capture behaved differently at the same
// value), which is the whole reason this is exposed as a control rather
// than left as a single fixed constant - this default is just a starting
// point for that control, not a validated number on its own.
const DEFAULT_CONNECTIVITY_MULTIPLIER = 3.0;

// Mounted inside <Canvas>, not in App's own top-level effects - same
// reasoning as InvalidateBridge: <CameraControls> lives on R3F's own
// separate reconciler, and a sibling component inside the same Canvas is
// what gives a reliable "the ref is attached by the time this effect
// runs" guarantee, unlike an effect on the outer DOM-based root trying
// to reach into it.
//
// wake/rest (not controlstart/controlend) are what's actually needed
// here: wake/rest track real camera motion, including the momentum/
// damping coasting period after a drag is released, which controlstart/
// controlend alone would miss entirely - and wheel-based zoom doesn't
// emit controlstart/controlend at all (a documented limitation of the
// underlying camera-controls library), so relying on those specifically
// would leave scroll-zoom clicks unprotected.
// Keeps frameloop="demand" rendering continuously while the breathe
// modifier is active - same reasoning as StreamlineField's showAero-gated
// invalidate loop. Spark's context.time (what the breathe's sin wave
// reads) only advances on frames R3F actually renders, and "demand" mode
// only renders in response to things like camera movement - without this
// nudge the animation sits frozen except when the user happens to be
// orbiting.
//
// invalidate() alone isn't enough, though: SparkRenderer.updateInternal
// only re-runs generate() (the pass that actually re-evaluates
// objectModifier/worldModifier into pixels) when the camera moved or the
// mesh's generator version changed - a stationary camera just redraws the
// same cached, stale buffer no matter how often render() fires.
// forceRegenerateEachFrame closes that second gap by calling
// updateGenerator() every frame, which bumps that version - see its own
// comment on the store field for the real cost this carries (a full
// shader recompile per frame, not a cheap refresh).
function SplatShaderAnimationDriver({
  active,
  splatMesh,
  forceRegenerateEachFrame,
}: {
  active: boolean;
  splatMesh: SplatMesh | null;
  forceRegenerateEachFrame: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    if (!active) return;
    if (forceRegenerateEachFrame && splatMesh) {
      splatMesh.updateGenerator();
    }
    invalidate();
  });
  return null;
}

function CameraActivityBridge({
  cameraControlsRef,
}: {
  cameraControlsRef: RefObject<CameraControls | null>;
}) {
  const setIsCameraMoving = useViewer((s) => s.setIsCameraMoving);
  useEffect(() => {
    const controls = cameraControlsRef.current;
    if (!controls) return;

    const handleWake = () => setIsCameraMoving(true);
    // rest deliberately not used here - it fires far more often than
    // wake/sleep (any brief pause mid-gesture counts as "resting"),
    // which was re-triggering the same per-render churn root-caused in
    // SparkFlyControls' isCameraMoving debounce - App.tsx reads
    // isCameraMoving reactively at the top level, so every extra flip
    // forces a full re-render. sleep alone is enough to mark the camera
    // settled once a gesture actually ends.
    const handleSleep = () => setIsCameraMoving(false);

    controls.addEventListener("wake", handleWake);
    controls.addEventListener("sleep", handleSleep);

    return () => {
      controls.removeEventListener("wake", handleWake);
      controls.removeEventListener("sleep", handleSleep);
      // This component only unmounts by switching cameraControlMode away
      // from "orbit" (App.tsx gates it on that), which means CameraControls
      // itself is unmounting too - nothing else will ever fire wake/sleep
      // for it again. Without this, isCameraMoving could be left stuck
      // true if the switch happens mid-drag/momentum (wake fired, sleep
      // hasn't yet) - SparkFlyControls only clears it once real movement
      // is detected in fly mode, so a switch-then-pause would otherwise
      // leave mesh.raycastable disabled indefinitely.
      setIsCameraMoving(false);
    };
  }, [cameraControlsRef, setIsCameraMoving]);

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
  const uploadedModelKind = useViewer((s) => s.uploadedModelKind);
  const uploadedSplatFileType = useViewer((s) => s.uploadedSplatFileType);
  const setModelUrl = useViewer((s) => s.setModelUrl);
  const setUploadedModelUrl = useViewer((s) => s.setUploadedModelUrl);
  const cameraControlMode = useViewer((s) => s.cameraControlMode);
  const cameraControlsRef = useRef<CameraControls | null>(null);
  const modelRef = useRef<Group | null>(null);
  const splatRef = useRef<SplatMesh | null>(null);
  const prevModelFieldRef = useRef<ModelFieldInfo | null>(null);
  const config = useAero((s) => s.config);
  const meshDeformation = useViewer((s) => s.meshDeformation);
  const clearPoints = useMeasurement((s) => s.clearPoints);
  const addPoint = useMeasurement((s) => s.addPoint);
  const points = useMeasurement((s) => s.points);
  const addAnnotation = useViewer((s) => s.addAnnotation);
  const setMarkerScale = useViewer((s) => s.setMarkerScale);
  const tool = useViewer((s) => s.tool);
  const setCameraControlMode = useViewer((s) => s.setCameraControlMode);
  const lodEnabled = useViewer((s) => s.lodEnabled);
  const setIsBuildingLod = useViewer((s) => s.setIsBuildingLod);
  const forceSplatRegenerateEachFrame = useViewer(
    (s) => s.forceSplatRegenerateEachFrame,
  );
  const vegetationThreshold = useViewer((s) => s.vegetationThreshold);
  const isCameraMoving = useViewer((s) => s.isCameraMoving);
  // Same mechanism TextureCanvas.tsx already uses for its own imperative,
  // outside-of-React mutations - applySparkFloaterThreshold directly
  // mutates the live Three.js object (setSplat + needsUpdate), which
  // React/R3F has no way to know happened on its own. Without this, the
  // change is only visible once something else happens to trigger a new
  // frame - orbiting the camera, for instance.
  const requestRender = useViewer((s) => s.requestRender);

  const focused = annotations.find((a) => a.id === focusedId) ?? null;
  const effectiveModelUrl = uploadedModelUrl ?? modelUrl;

  const selectedModel = models.find((m) => m.modelUrl === modelUrl);
  const isSplatModel = uploadedModelUrl
    ? uploadedModelKind === "splat"
    : selectedModel?.kind === "splat";
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
  // Tracks which mesh (if any) currently has a createLodSplats() call in
  // flight - packedSplats.lodSplats only gets set once that call resolves,
  // so checking lodSplats alone can't distinguish "never started" from
  // "already running", letting a rapid off/on/off toggle within one
  // build's multi-second window kick off a second concurrent build. See
  // the LOD effect below.
  const lodBuildInFlightRef = useRef<SplatMesh | null>(null);
  // Bumps once per newly-extracted splat-centers array; the actual buffer
  // lives in splatCentersGraphHolder.ts, not React state - see that
  // module's comment and Measurement.tsx's splatCentersVersion prop for
  // why. This primitive is what's safe to pass down to trigger Measurement's
  // graph-rebuild effect and to gate UI on "do we have centers yet".
  const [splatCentersVersion, setSplatCentersVersion] = useState(0);
  // Mirrors the same data (forClicks, a separate buffer copy - see
  // splatCenters.worker.ts) - exists specifically so handleSplatClick can
  // read the current value at call time without needing it in its own
  // useCallback dependency array.
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
  // Secondary control, not a live slider like floaterThreshold - changing
  // this requires a genuine re-run of the worker's k-d tree/union-find
  // pass (it changes how the connectivity graph itself gets built, not
  // just how already-computed sizes get filtered), so it only takes
  // effect the next time Analyze/Re-analyze is actually clicked, not on
  // every drag tick.
  const [connectivityMultiplier, setConnectivityMultiplier] = useState(
    DEFAULT_CONNECTIVITY_MULTIPLIER,
  );

  const [splatTransformDisplay, setSplatTransformDisplay] =
    useState<SplatTransformSnapshot | null>(null);
  // True once the user has actually dragged the gizmo or edited a
  // position/rotation field via handleSplatPositionEdit/
  // handleSplatRotationEdit for the currently-loaded splat - not the same
  // as showTransformControls being on, which just means the panel/gizmo
  // is visible. This is what requestModelChange checks: showing the
  // gizmo costs nothing to lose, an actual correction does.
  const [hasManualTransformEdit, setHasManualTransformEdit] = useState(false);
  // The transform captured at the moment splatCenters was last actually
  // extracted (initial load, or a manual "Refresh Measurement Data")—
  // compared against the live splatTransformDisplay to detect whether
  // the geodesic graph / click-based annotation data has gone stale.
  // Confirmed as a real bug, not a hypothetical: neither the gizmo nor
  // the Transform Panel's position/rotation edits ever re-extract
  // centers on their own, so a transform edit after load silently leaves
  // measurement data pointing at pre-transform positions with no
  // indication anything's wrong - this is what actually surfaces that.
  const [
    splatCentersExtractedAtTransform,
    setSplatCentersExtractedAtTransform,
  ] = useState<SplatTransformSnapshot | null>(null);
  const [splatProgress, setSplatProgress] =
    useState<SplatLoadProgressValue | null>(null);
  // Tracks the gap between the splat becoming visible and the
  // main-thread work setSplatCenters triggers actually finishing (a
  // "Cascading Update" confirmed via trace analysis, currently still
  // unresolved despite fixing GizmoHelper's unstable array props - this
  // doesn't make that work any faster, it's a detection mechanism so the
  // UI can at least show something during it instead of silently
  // freezing with no explanation).
  const [isPreparingSplatData, setIsPreparingSplatData] = useState(false);

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
    setSplatTransformDisplay(getSplatTransformSnapshot(target));
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
      setHasManualTransformEdit(true);
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
      setHasManualTransformEdit(true);
    },
    [readSplatTransform],
  );

  // splatCenters (and splatCentersRef) are only ever extracted once, at
  // load time, using whatever matrixWorld the splat had at that exact
  // moment - confirmed via source tracing: neither handleSplatPositionEdit
  // nor handleSplatRotationEdit, nor TransformControls' own
  // onObjectChange, ever call setSplatCenters. This means the geodesic
  // worker's graph, and the click-based normal-estimation ref, both go
  // stale the instant a loaded splat is moved or rotated afterward -
  // confirmed as a real bug, not just a theoretical risk: a click's
  // world-space point is current, but the graph it's compared against is
  // frozen at pre-transform positions.
  //
  // Deliberately manual for now rather than automatic - re-extracting on
  // every single gizmo-drag frame would mean re-running a real, worker-
  // bound k-d tree/extraction pass dozens of times a second while
  // dragging, the same reasoning that kept the floater connectivity
  // multiplier from being a live-drag control. A manual trigger, used
  // once after finishing an edit, is the deliberately simple version of
  // this fix - automatic (debounced) re-extraction is a reasonable next
  // step if this proves too easy to forget to click.
  const [isRefreshingMeasurementData, setIsRefreshingMeasurementData] =
    useState(false);
  const handleRefreshSplatMeasurementData = useCallback(async () => {
    const targetSplat = splatRef.current;
    if (!targetSplat) return;
    setIsRefreshingMeasurementData(true);
    try {
      const { forState, forClicks } =
        await extractSparkSplatCentersAsync(targetSplat);
      // Staleness guard, same reasoning as handleSparkSplatLoad's - if
      // the user switched models while this was running, applying the
      // result now would silently corrupt whatever's actually loaded.
      if (splatRef.current !== targetSplat) return;
      splatCentersRef.current = forClicks;
      setSplatCentersExtractedAtTransform(
        getSplatTransformSnapshot(targetSplat),
      );
      // Same two-frame staggering as applySplatCenters in handleSplatLoad -
      // see that comment for the full reasoning. Bumping the version
      // triggers Measurement's graph-rebuild effect (worker post + array
      // copy) synchronously on commit, so without yielding first, the
      // isRefreshingMeasurementData spinner set above would never get a
      // chance to actually paint before that freeze. Awaited (not just
      // fired off) so `finally` below doesn't clear the spinner until the
      // main thread is genuinely free again - the same detection
      // mechanism the load path relies on: the second rAF's callback
      // can't run until the browser schedules it, which can't happen
      // until whatever the first rAF triggered has finished.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          // Re-checked here, not just before the deferral above - the
          // user has a full frame to switch models in between, and
          // without this a stale write would silently land on whatever
          // splat is actually current by the time this fires.
          if (splatRef.current !== targetSplat) {
            resolve();
            return;
          }
          setSplatCentersForGraph(forState);
          setSplatCentersVersion((v) => v + 1);
          requestAnimationFrame(() => resolve());
        });
      });
    } catch (error) {
      console.error("Failed to refresh splat measurement data:", error);
    } finally {
      setIsRefreshingMeasurementData(false);
    }
  }, []);

  const handleField = useCallback((f: ModelFieldInfo) => setModelField(f), []);

  // The actual mechanics of switching, split out from requestModelChange
  // so both the "no reasons, just do it" fast path and the dialog's
  // onConfirm can share one implementation.
  const applyModelChange = useCallback(
    (change: PendingModelChange) => {
      if (change.isUpload) {
        const upload = change.upload;
        setUploadedModelUrl(
          change.url,
          upload?.kind ?? null,
          upload?.kind === "splat" ? upload.fileType : null,
        );
      } else {
        setUploadedModelUrl(null);
        setModelUrl(change.url);
      }
    },
    [setUploadedModelUrl, setModelUrl],
  );

  const [pendingModelChange, setPendingModelChange] = useState<{
    change: PendingModelChange;
    reasons: string[];
  } | null>(null);

  // Gate in front of applyModelChange - the only thing Toolbar/ModelPicker
  // should call to switch models. Computes what's actually about to be
  // silently discarded (mirrors the four cases ModelSwitchConfirmDialog's
  // own docstring names) and only interrupts the switch if there's
  // something real to warn about.
  const requestModelChange = useCallback(
    (change: PendingModelChange) => {
      const reasons: string[] = [];
      if (isSplatModel && hiddenFloaterCount > 0) {
        reasons.push("Floater cleanup results");
      }
      if (isSplatModel && hasManualTransformEdit) {
        reasons.push("Manual orientation correction");
      }
      if (points.length > 0) {
        reasons.push("In-progress measurement");
      }
      if (
        uploadedModelUrl &&
        annotations.some((a) => a.modelUrl === uploadedModelUrl)
      ) {
        reasons.push("Annotations on the uploaded model");
      }

      if (reasons.length === 0) {
        applyModelChange(change);
        return;
      }
      setPendingModelChange({ change, reasons });
    },
    [
      isSplatModel,
      hiddenFloaterCount,
      hasManualTransformEdit,
      points,
      uploadedModelUrl,
      annotations,
      applyModelChange,
    ],
  );

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
    setIsPreparingSplatData(false);
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

  // Compares the live transform against the one captured at last
  // extraction - epsilons account for ordinary floating-point noise
  // (repeated updateMatrixWorld calls, etc.), not meant to tolerate any
  // real, intentional edit. Position tolerance is in scene units, so
  // it's necessarily a guess about "how precise does this need to be" -
  // fine for typical scene scales, but worth knowing if you're working
  // at a very different scale than what this was built against.
  const isMeasurementDataStale = useMemo(() => {
    if (!splatTransformDisplay || !splatCentersExtractedAtTransform) {
      return false;
    }
    const POSITION_EPSILON = 0.0001;
    const ROTATION_EPSILON_DEG = 0.01;
    const positionChanged = splatTransformDisplay.position.some(
      (v, i) =>
        Math.abs(v - splatCentersExtractedAtTransform.position[i]) >
        POSITION_EPSILON,
    );
    const rotationChanged = splatTransformDisplay.rotationDeg.some(
      (v, i) =>
        Math.abs(v - splatCentersExtractedAtTransform.rotationDeg[i]) >
        ROTATION_EPSILON_DEG,
    );
    return positionChanged || rotationChanged;
  }, [splatTransformDisplay, splatCentersExtractedAtTransform]);

  useEffect(() => {
    setModelField(null);
    setShowTransformControls(false);
    setMeshDeformation(false);
    setErrorMessage(null);
    setLoadedSplatMesh(null);
    setIsBuildingLod(false);
    setSplatCentersForGraph(null);
    setSplatCentersVersion(0);
    clearPoints();
    splatCentersRef.current = null;
    setFloaterAnalysis(null);
    setIsAnalyzingFloaters(false);
    setFloaterThreshold(DEFAULT_FLOATER_THRESHOLD);
    setHiddenFloaterCount(0);
    setConnectivityMultiplier(DEFAULT_CONNECTIVITY_MULTIPLIER);
    setSplatTransformDisplay(null);
    setSplatCentersExtractedAtTransform(null);
    setSplatProgress(null);
    // lodEnabled deliberately NOT reset here - it's a sticky, global
    // preference (see state.tsx), not per-model. The LOD effect
    // (keyed on [lodEnabled, loadedSplatMesh]) re-applies it to every
    // new load automatically; resetting it here would silently turn
    // that into a one-shot instead of a standing preference.
    setIsPreparingSplatData(false);
    setHasManualTransformEdit(false);
    setCameraControlMode("orbit");
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
          setSplatCentersExtractedAtTransform(
            getSplatTransformSnapshot(splatMesh),
          );
          setIsPreparingSplatData(true);
          // Yield one frame before triggering the actual update - without
          // this, the version bump below could get batched into the very
          // same blocking render pass as setIsPreparingSplatData itself,
          // meaning the "preparing" indicator would never get a chance
          // to actually paint before the freeze begins.
          requestAnimationFrame(() => {
            // Re-checked here - handleSparkSplatLoad's own staleness guard
            // ran before applySplatCenters was even called, but the user
            // has a full frame to switch models in between that call and
            // this deferred one, which would otherwise let a stale write
            // land on whatever splat is actually current by the time this
            // fires.
            if (splatRef.current !== splatMesh) return;
            setSplatCentersForGraph(forState);
            setSplatCentersVersion((v) => v + 1);
            // Queued behind whatever that version bump ends up triggering,
            // however long that turns out to be - a callback scheduled
            // here genuinely cannot run until the main thread is free
            // again, since JS is single-threaded and this is queued
            // behind the current blocking work. That's the actual
            // detection mechanism: not a timer or a guess, just relying
            // on the browser's own scheduling guarantee. This doesn't
            // make the underlying cascade any faster.
            requestAnimationFrame(() => {
              setSplatProgress(null);
              setIsPreparingSplatData(false);
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

  // Applies lodEnabled to whichever splat is currently loaded - fires both
  // when the toggle changes (apply to the current splat immediately) and
  // when loadedSplatMesh changes while lodEnabled is already true (build
  // LOD for every new load automatically, in the background). Genuinely
  // in the background: createLodSplats() operates on data already
  // decoded and resident, dispatched to Spark's own worker pool, so it
  // never blocks the splat that's already rendering - see SparkSplat.tsx
  // for why the initial load itself no longer builds LOD at all.
  //
  // Toggling off uses SplatMesh's own enableLod flag rather than disposing
  // the built LOD data - confirmed from source that update() reads
  // enableLod fresh every frame (`if (this.enableLod === false) {
  // this.context.enableLod.value = false; }`), independent of whether
  // packedSplats.lodSplats still exists. So this is an instant, free
  // toggle in both directions once LOD has been built once - the
  // alternative (disposeLodSplats() on toggle-off) would force a full
  // rebuild on every re-enable, since createLodSplats() has no way to
  // resume from a previous result.
  useEffect(() => {
    const mesh = loadedSplatMesh;
    if (!mesh?.packedSplats) return;
    mesh.enableLod = lodEnabled;
    if (!lodEnabled) return;

    // Already built - just flipping enableLod above is enough, no need
    // to rebuild. Checking lodSplats directly (not packedSplats.lod,
    // which createLodSplats() sets and never clears) so this correctly
    // detects "never built yet" regardless of how many times enableLod
    // has been toggled since.
    if (mesh.packedSplats.lodSplats) return;
    // A build is already running for this exact mesh - lodSplats alone
    // can't tell "never started" apart from "in progress", since it's
    // only set once createLodSplats() resolves. Without this, toggling
    // off/on/off again inside one build's multi-second window would kick
    // off a second concurrent build racing to set lodSplats on completion.
    if (lodBuildInFlightRef.current === mesh) return;

    lodBuildInFlightRef.current = mesh;
    setIsBuildingLod(true);
    mesh.packedSplats
      .createLodSplats({ quality: false })
      .catch((error: unknown) => {
        console.error("Failed to build LOD splats:", error);
      })
      .finally(() => {
        if (lodBuildInFlightRef.current === mesh) {
          lodBuildInFlightRef.current = null;
        }
        // Staleness guard, same reasoning as handleSparkSplatLoad's - if
        // the user switched models while this was building, the spinner
        // belongs to whatever's actually loaded now, not this mesh.
        if (splatRef.current !== mesh) return;
        setIsBuildingLod(false);
      });
  }, [lodEnabled, loadedSplatMesh]);

  // Applies the breathing displacement to whichever splat is currently
  // loaded, restricted to vegetation-colored splats - same reactive
  // pattern as the lodEnabled effect above, so dragging the threshold
  // slider in the Toolbar re-applies immediately rather than only taking
  // effect on the next model load.
  useEffect(() => {
    if (!loadedSplatMesh) return;
    loadedSplatMesh.objectModifier = createSparkBreatheModifier(
      loadedSplatMesh,
      { amplitude: 0.05, speed: 2, noiseAmplitude: 0.02 },
      { threshold: vegetationThreshold, invert: false },
    );
    loadedSplatMesh.updateGenerator();
  }, [loadedSplatMesh, vegetationThreshold]);

  // Disables SplatMesh's own raycasting while the camera is actively being
  // orbited/zoomed. Confirmed from source: SplatMesh.raycast()'s very
  // first line is `if (!this.raycastable || ...) return;` - a real,
  // measurable WASM raycast (raycast_packed_buffer, tested against every
  // splat) only runs past that check. React-three-fiber's pointer-event
  // system raycasts every object with a registered handler (SparkSplat
  // only has onClick here) on every relevant DOM event it listens to -
  // a trace of wheel-zoom with LOD off showed this raycast alone
  // accounting for ~48% of sampled main-thread time during a sustained
  // frame-drop, fired once per wheel tick. Re-enabled the moment the
  // camera settles, so click-to-measure/annotate still works normally
  // once the user stops navigating.
  useEffect(() => {
    const mesh = loadedSplatMesh;
    if (!mesh) return;
    mesh.raycastable = !isCameraMoving;
  }, [isCameraMoving, loadedSplatMesh]);

  const handleSplatClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      // Non-reactive read (getState, not the useViewer hook) -
      // deliberately not a subscription, so this callback's own identity
      // doesn't change every time wake/rest fires during an orbit, which
      // could otherwise ripple into anything keyed on handleSplatClick's
      // reference elsewhere.
      if (useViewer.getState().isCameraMoving) return;
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

  // Reuses the extracted splat centers (already extracted for the
  // geodesic feature) rather than re-decoding centers from scratch - see
  // analyzeSparkSplatFloaters's own comment for why. Requires centers to
  // already be populated, which is why the panel gates its "Analyze"
  // button on that rather than just on a splat being loaded at all. Reads
  // getSplatCentersForGraph() fresh at call time rather than closing over
  // a stale value, so it doesn't need splatCentersVersion in its own
  // dependency array.
  const handleAnalyzeFloaters = useCallback(async () => {
    const splatCenters = getSplatCentersForGraph();
    if (!splatRef.current || !splatCenters || splatCenters.length === 0) return;
    const targetSplat = splatRef.current;
    setIsAnalyzingFloaters(true);
    try {
      // If a previous analysis already hid some splats (opacity 0 in the
      // live data) and this is a re-analyze, restoring first is required,
      // not optional - analyzeSparkSplatFloaters reads opacity straight
      // from the live packed data as its "original" baseline for the new
      // pass. Without this, any splat already hidden would have that
      // baseline permanently captured as 0, making it impossible to ever
      // un-hide via a later threshold change, regardless of what the new
      // analysis actually says about it. Only relevant now that
      // Re-analyze makes this reachable at all - the very first Analyze
      // on a freshly-loaded splat has nothing to restore.
      if (floaterAnalysis) {
        revertSparkFloaterAnalysis(targetSplat, floaterAnalysis, lodEnabled);
      }

      const result = await analyzeSparkSplatFloaters(
        targetSplat,
        splatCenters,
        undefined, // k - keep its own default, only the multiplier is user-adjustable here
        connectivityMultiplier,
      );
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
      requestRender();
    } catch (error) {
      console.error("Floater analysis failed:", error);
    } finally {
      setIsAnalyzingFloaters(false);
    }
  }, [
    floaterThreshold,
    connectivityMultiplier,
    floaterAnalysis,
    requestRender,
    lodEnabled,
  ]);

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
      requestRender();
    },
    [floaterAnalysis, requestRender],
  );

  // Reverts opacity to original and restores LOD to the user's own
  // preference (see revertSparkFloaterAnalysis's own comments), then
  // resets local state back to the pre-analysis view -
  // analysisReady={floaterAnalysis !== null} in the panel means clearing
  // this is what actually brings the "Analyze for Floaters" button back,
  // not just a visual reset.
  const handleRevertFloaters = useCallback(() => {
    if (splatRef.current) {
      revertSparkFloaterAnalysis(splatRef.current, floaterAnalysis, lodEnabled);
      requestRender();
    }
    setFloaterAnalysis(null);
    setFloaterThreshold(DEFAULT_FLOATER_THRESHOLD);
    setHiddenFloaterCount(0);
  }, [floaterAnalysis, requestRender, lodEnabled]);

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
        <Toolbar
          modelRef={modelRef}
          requestModelChange={requestModelChange}
          onUnsupportedFile={(filename) =>
            setErrorMessage(`Unsupported file type: ${filename}`)
          }
        />
        {!isSplatModel && (
          <TextureEdit modelRef={modelRef} modelUrl={effectiveModelUrl} />
        )}
        {isSplatModel && showTransformControls && splatTransformDisplay && (
          <SplatTransformPanel
            position={splatTransformDisplay.position}
            rotationDeg={splatTransformDisplay.rotationDeg}
            onPositionChange={handleSplatPositionEdit}
            onRotationChange={handleSplatRotationEdit}
            onRefreshMeasurementData={handleRefreshSplatMeasurementData}
            isRefreshingMeasurementData={isRefreshingMeasurementData}
          />
        )}
        {isSplatModel &&
          splatCentersVersion > 0 &&
          (getSplatCentersForGraph()?.length ?? 0) > 0 && (
            <FloaterCleanupPanel
              isAnalyzing={isAnalyzingFloaters}
              analysisReady={floaterAnalysis !== null}
              hiddenCount={hiddenFloaterCount}
              totalCount={floaterAnalysis?.componentSizeFractions.length ?? 0}
              threshold={floaterThreshold}
              onAnalyze={handleAnalyzeFloaters}
              onThresholdChange={handleFloaterThresholdChange}
              onRevert={handleRevertFloaters}
              connectivityMultiplier={connectivityMultiplier}
              onConnectivityMultiplierChange={setConnectivityMultiplier}
            />
          )}
        {isSplatModel && isMeasurementDataStale && (
          <StaleMeasurementDataWarning
            onRefresh={handleRefreshSplatMeasurementData}
            isRefreshing={isRefreshingMeasurementData}
          />
        )}
      </div>
      {pendingModelChange && (
        <ModelSwitchConfirmDialog
          reasons={pendingModelChange.reasons}
          onCancel={() => setPendingModelChange(null)}
          onConfirm={() => {
            applyModelChange(pendingModelChange.change);
            setPendingModelChange(null);
          }}
        />
      )}
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
        <SplatLoadProgress
          progress={splatProgress}
          indeterminateMessage={
            isPreparingSplatData ? "Preparing measurement data…" : null
          }
        />
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
          backgroundColor: "black",
        }}
        camera={{ near: 0.001, far: 1000 }}
        gl={{ antialias: isSplatModel ? false : true }}
        // FlyControls needs a per-frame update loop to track held-down
        // WASD/mouse-look input, unlike CameraControls which only needs a
        // render when something actually changes ("demand").
        frameloop={
          isSplatModel || cameraControlMode === "fly" ? "always" : "demand"
        }
        dpr={[1, 2]}
      >
        <GizmoHelper alignment="bottom-right" margin={GIZMO_MARGIN}>
          <GizmoViewport axisColors={GIZMO_AXIS_COLORS} labelColor="white" />
        </GizmoHelper>
        {cameraControlMode === "orbit" && (
          <CameraControls
            ref={cameraControlsRef}
            makeDefault
            // Default 1.0 - camera-controls' dolly (mouse wheel/pinch)
            // applies an exponential distance scale per wheel event
            // (distance *= 0.95^(-delta*dollySpeed)), with no cap on how
            // many events a fast scroll burst can fire before the next
            // render. Unlike WASD/fly movement (which is speed-capped via
            // inertia), a quick flick of the wheel can collapse the
            // camera-to-splat distance to near zero within a handful of
            // events - and splat overdraw cost scales sharply with
            // proximity, causing the frame drops seen specifically during
            // zoom. Lowering this slows how fast that collapse can happen
            // without capping zoom range or removing damping.
            dollySpeed={0.4}
          />
        )}
        <SparkFlyControls active={cameraControlMode === "fly"} />
        <InvalidateBridge />
        <SplatShaderAnimationDriver
          active={loadedSplatMesh !== null}
          splatMesh={loadedSplatMesh}
          forceRegenerateEachFrame={forceSplatRegenerateEachFrame}
        />
        {cameraControlMode === "orbit" && (
          <CameraActivityBridge cameraControlsRef={cameraControlsRef} />
        )}

        {isSplatModel && effectiveModelUrl && (
          <>
            <SparkScene />
            <SparkSplat
              key={`${effectiveModelUrl}-${retryToken}`}
              ref={splatRef}
              url={effectiveModelUrl}
              fileType={
                uploadedModelUrl
                  ? (uploadedSplatFileType ?? undefined)
                  : undefined
              }
              onLoad={handleSplatLoad}
              onError={handleSplatError}
              onProgress={handleSplatProgress}
              onClick={handleSplatClick}
            />
          </>
        )}

        <ErrorBoundary
          fallback={null}
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
                onObjectChange={() => {
                  readSplatTransform();
                  if (isSplatModel) setHasManualTransformEdit(true);
                }}
              />
            )}
            {cameraControlMode === "orbit" && (
              <CameraFocus
                resetCallback={() => setResetCamera(false)}
                cameraControlsRef={cameraControlsRef}
                focused={focused}
                focusedId={focusedId}
                resetCameraPos={resetCamera}
              />
            )}
            <Annotations />
            <Measurement
              modelRef={modelRef}
              modelUrl={effectiveModelUrl}
              meshReadyToken={meshReadyToken}
              splatCentersVersion={splatCentersVersion}
            />
            {!isSplatModel && (
              <>
                {cameraControlMode === "orbit" && (
                  <FrameOnLoad
                    controlsRef={cameraControlsRef}
                    modelRef={modelRef}
                    modelUrl={effectiveModelUrl}
                  />
                )}
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
        <Grid side={DoubleSide} infiniteGrid />
      </Canvas>
    </>
  );
}

export default App;
