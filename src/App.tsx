import { Canvas, useThree } from "@react-three/fiber";
import { Model, type ModelFieldInfo } from "./components/Model";
import {
  Html,
  Environment,
  CameraControls,
  Grid,
  Stats,
  TransformControls,
  useGLTF,
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
import type { Annotation } from "./state/state";
import { Box3, Mesh, type Group } from "three";
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
      cameraControlsRef.current.setLookAt(
        camX,
        camY,
        camZ, // where the camera moves TO
        px,
        py,
        pz, // what it looks AT (the annotation point)
        true, // enableTransition = smooth animated move
      );
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
    controlsRef.current.saveState(); // remember this pose so reset() can restore it later
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
  const modelUrl = useViewer((s) => s.modelUrl);
  const setResetCamera = useViewer((s) => s.setResetCamera);
  const pruneUploadedAnnotations = useViewer((s) => s.pruneUploadedAnnotations);
  const setShowTransformControls = useViewer((s) => s.setShowTransformControls);
  const setMeshDeformation = useViewer((s) => s.setMeshDeformation);
  const resetCamera = useViewer((s) => s.resetCamera);
  const uploadedModelUrl = useViewer((s) => s.uploadedModelUrl);
  const cameraControlsRef = useRef<CameraControls | null>(null);
  const modelRef = useRef<Group | null>(null);
  const prevModelFieldRef = useRef<ModelFieldInfo | null>(null);
  const config = useAero((s) => s.config);
  const meshDeformation = useViewer((s) => s.meshDeformation);

  const focused = annotations.find((a) => a.id === focusedId) ?? null;
  const effectiveModelUrl = uploadedModelUrl ?? modelUrl;

  const [modelField, setModelField] = useState<ModelFieldInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
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
  }, [effectiveModelUrl]);

  useEffect(() => {
    const prev = prevModelFieldRef.current;
    if (prev && prev !== modelField) {
      prev.collisionGeometry?.dispose();
    }
    prevModelFieldRef.current = modelField;
  }, [modelField]);
  //End

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
        <TextureEdit modelRef={modelRef} modelUrl={effectiveModelUrl} />
      </div>
      {errorMessage && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-black/80 p-4 text-center text-white backdrop-blur break-words">
            <h1 className="text-lg font-semibold md:text-xl">
              {errorMessage}
            </h1>
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
        frameloop="demand"
        dpr={[1, 2]}
      >
        {/* <Stats /> */}
        <CameraControls ref={cameraControlsRef} makeDefault />
        <InvalidateBridge />
        <ErrorBoundary
          fallback={null} // or a fallback mesh, e.g. <group /> or a placeholder <mesh>
          onError={(error) => {
            setErrorMessage((error as Error).message);
          }}
          resetKeys={[retryToken]}
        >
          {meshDeformation && modelRef.current && (
            <MeshDeformation object={modelRef.current} renderObject={false} />
          )}
          <Suspense fallback={null}>
            {effectiveModelUrl && (
              <Model
                ref={modelRef}
                url={effectiveModelUrl}
                onField={handleField}
              />
            )}
            {showTransformControls && effectiveModelUrl && (
              <>
                <TransformControls
                  object={modelRef as RefObject<Group>}
                  mode={transformControlsMode}
                />
              </>
            )}
            <FrameOnLoad
              controlsRef={cameraControlsRef}
              modelRef={modelRef}
              modelUrl={effectiveModelUrl}
            />
            <CameraFocus
              resetCallback={() => setResetCamera(false)}
              cameraControlsRef={cameraControlsRef}
              focused={focused}
              focusedId={focusedId}
              resetCameraPos={resetCamera}
            />
            <Measurement modelRef={modelRef} modelUrl={effectiveModelUrl} />
            <Annotations />
            <Environment preset="city" />
          </Suspense>
        </ErrorBoundary>

        {showAero && enrichedField && modelField && (
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
      <Loader />
    </>
  );
}

export default App;
