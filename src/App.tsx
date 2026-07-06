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
  useEffect(() => {
    if (!cameraControlsRef.current) return;
    if (focused) {
      const dist = 3;
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
}: {
  controlsRef: RefObject<CameraControls | null>;
  modelRef: RefObject<Group | null>;
}) {
  useEffect(() => {
    if (!controlsRef.current || !modelRef.current) return;
    const box = new Box3().setFromObject(modelRef.current);
    const offset = -box.min.y;
    modelRef.current.position.y += offset;
    box.min.y += offset;
    box.max.y += offset;
    controlsRef.current.fitToBox(box, false);
    controlsRef.current.saveState(); // remember this pose so reset() can restore it later
  }, []);
  return null;
}

function App() {
  const points = useMeasurement((s) => s.points);
  const annotations = useViewer((s) => s.annotations);
  const tool = useViewer((s) => s.tool);
  const setMeasurementMode = useMeasurement((s) => s.setMeasurementMode);
  const surfaceDistance = useMeasurement((s) => s.surfaceDistance);
  const setTool = useViewer((s) => s.setTool);
  const focusedId = useViewer((s) => s.focusedId);
  const setFocusedId = useViewer((s) => s.setFocusedId);
  const clearPoints = useMeasurement((s) => s.clearPoints);

  const [resetCameraPos, setResetCameraPos] = useState<boolean>(false);
  const cameraControlsRef = useRef<CameraControls | null>(null);
  const modelRef = useRef<Group | null>(null);

  const focused = annotations.find((a) => a.id === focusedId) ?? null;
  const url = "/models/triceratops_skull.glb";

  const distance = points.length === 2 ? points[0].distanceTo(points[1]) : null;
  return (
    <>
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-10
                flex items-center gap-2 bg-black/70 backdrop-blur rounded-lg p-2
                md:left-4 md:translate-x-0"
      >
        <select
          className="rounded text-white bg-white/10 px-3 py-1"
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
        {tool === "measure" && (
          <select
            className="rounded text-white bg-white/10 px-3 py-1"
            onChange={(e) =>
              setMeasurementMode(e.target.value as "linear" | "geodesic")
            }
          >
            <option
              className="rounded bg-black/70 text-white px-2 py-1"
              value="linear"
            >
              Linear
            </option>
            <option
              className="rounded bg-black/70 text-white px-2 py-1"
              value="geodesic"
            >
              Geodesic
            </option>
          </select>
        )}
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
          <p className="bg-black/70 text-white px-3 rounded">
            Straight: {distance.toFixed(2)}m
            {surfaceDistance !== null && (
              <> · Surface: {surfaceDistance.toFixed(2)}m</>
            )}
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
          <Suspense fallback={<Loader />}>
            <Model ref={modelRef} url={url} />
            <FrameOnLoad controlsRef={cameraControlsRef} modelRef={modelRef} />
            <CameraFocus
              resetCallback={() => setResetCameraPos(false)}
              cameraControlsRef={cameraControlsRef}
              focused={focused}
              focusedId={focusedId}
              resetCameraPos={resetCameraPos}
            />
            <Measurement modelRef={modelRef} />
            <Annotations />
            <Environment preset="city" />
          </Suspense>
        </ErrorBoundary>
        <Grid infiniteGrid fadeDistance={20} />
      </Canvas>
    </>
  );
}

export default App;
