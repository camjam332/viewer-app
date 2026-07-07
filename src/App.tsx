import { Canvas } from "@react-three/fiber";
import { Model } from "./components/Model";
import { Html, Environment, CameraControls, Grid } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";
import { useViewer } from "./state/state";
import { useMeasurement } from "./state/measurementState";
import { Measurement } from "./components/Measurement";
import { Annotations } from "./components/Annotations";
import { Sidebar } from "./ui/Sidebar";
import { ModelPicker, type ModelOption } from "./ui/ModelPicker";
import type { Annotation, Tool } from "./state/state";
import { Box3, type Group } from "three";

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
    const offset = -box.min.y;
    modelRef.current.position.y += offset;
    box.min.y += offset;
    box.max.y += offset;
    controlsRef.current.fitToBox(box, false);
    controlsRef.current.saveState(); // remember this pose so reset() can restore it later
  }, [modelUrl]);
  return null;
}

function App() {
  const points = useMeasurement((s) => s.points);
  const annotations = useViewer((s) => s.annotations);
  const clearAnnotations = useViewer((s) => s.clearAnnotations);
  const pruneUploadedAnnotations = useViewer((s) => s.pruneUploadedAnnotations);
  const setTool = useViewer((s) => s.setTool);
  const focusedId = useViewer((s) => s.focusedId);
  const setFocusedId = useViewer((s) => s.setFocusedId);
  const clearPoints = useMeasurement((s) => s.clearPoints);
  const setModelUrl = useViewer((s) => s.setModelUrl);
  const modelUrl = useViewer((s) => s.modelUrl);

  const [resetCameraPos, setResetCameraPos] = useState<boolean>(false);
  // Local, non-persisted: an uploaded file is a one-off blob URL that's
  // invalid after a refresh, so it must never reach the persisted
  // `modelUrl` in the store. It overrides `modelUrl` for this session only.
  const [uploadedModelUrl, setUploadedModelUrl] = useState<string | null>(null);

  const effectiveModelUrl = uploadedModelUrl ?? modelUrl;
  const cameraControlsRef = useRef<CameraControls | null>(null);
  const modelRef = useRef<Group | null>(null);

  // An uploaded model's blob URL never survives a refresh, so any
  // annotations tied to it are now orphaned — drop them once on load.
  useEffect(() => {
    pruneUploadedAnnotations();
  }, [pruneUploadedAnnotations]);

  const focused = annotations.find((a) => a.id === focusedId) ?? null;
  const models: ModelOption[] = [
    {
      modelUrl:
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoomBox/glTF-Binary/BoomBox.glb",
      name: "Boom Box",
      screenshotUrl:
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoomBox/screenshot/screenshot.jpg",
    },
    {
      modelUrl:
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
      name: "Damaged Helmet",
      screenshotUrl:
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/screenshot/screenshot.png",
    },
    {
      modelUrl:
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Lantern/glTF-Binary/Lantern.glb",
      name: "Lantern",
      screenshotUrl:
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Lantern/screenshot/screenshot.jpg",
    },
    {
      modelUrl: "/models/triceratops_skull.glb",
      name: "Triceratops (Scan)",
    },
    {
      modelUrl: "/models/cadillac_fleetwood_brougham_1997_pink/scene.gltf",
      name: "Cadillac (Scan)",
    },
  ];
  const distance = points.length === 2 ? points[0].distanceTo(points[1]) : null;
  return (
    <>
      <div
        className="fixed top-2 inset-x-2 z-10
                flex flex-wrap items-center justify-center gap-2 bg-black/70 backdrop-blur rounded-lg p-2
                md:top-4 md:inset-x-auto md:left-4 md:right-auto md:w-auto md:justify-start md:flex-nowrap"
      >
        <select
          className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
          onChange={(e) => setTool(e.target.value as Tool)}
        >
          <option
            className="rounded bg-black/70 text-white px-2 py-1"
            value="orbit"
          >
            Orbit
          </option>
          <option
            className="rounded bg-black/70 text-white px-2 py-1"
            value="measure"
          >
            Measure
          </option>
          <option
            className="rounded bg-black/70 text-white px-2 py-1"
            value="annotate"
          >
            Annotate
          </option>
        </select>
        <ModelPicker
          models={models}
          modelUrl={modelUrl}
          setModelUrl={(url) => {
            setUploadedModelUrl(null);
            setModelUrl(url);
          }}
          uploadedModelUrl={uploadedModelUrl}
          onUploadModel={setUploadedModelUrl}
        />
        <button
          className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
          onClick={() => {
            setFocusedId(null);
            setResetCameraPos(true);
          }}
        >
          Reset Camera
        </button>
        {points.length > 0 && (
          <button
            className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
            onClick={clearPoints}
          >
            Clear Points
          </button>
        )}
        {distance !== null && (
          <p className="rounded text-white px-3 py-1">
            Distance: {distance.toFixed(2) + "m"}
          </p>
        )}
      </div>
      <Sidebar />
      <Canvas
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
        camera={{ near: 0.01, far: 1000 }}
        frameloop="demand"
        dpr={[1, 2]}
      >
        <CameraControls ref={cameraControlsRef} makeDefault />
        <ErrorBoundary
          fallbackRender={({ error }) => (
            <Html center>
              <h1>Failed to load model: {(error as Error).message}</h1>
            </Html>
          )}
        >
          <Suspense fallback={null}>
            <Model ref={modelRef} url={effectiveModelUrl} />
            <FrameOnLoad
              controlsRef={cameraControlsRef}
              modelRef={modelRef}
              modelUrl={effectiveModelUrl}
            />
            <CameraFocus
              resetCallback={() => setResetCameraPos(false)}
              cameraControlsRef={cameraControlsRef}
              focused={focused}
              focusedId={focusedId}
              resetCameraPos={resetCameraPos}
            />
            <Measurement />
            <Annotations />
            <Environment preset="city" />
          </Suspense>
        </ErrorBoundary>
        <Grid infiniteGrid fadeDistance={50} />
      </Canvas>
      <Loader />
    </>
  );
}

export default App;
