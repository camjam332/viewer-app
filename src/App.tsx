import { Canvas, useThree } from "@react-three/fiber";
import { Model } from "./components/Model";
import { Html, Environment, CameraControls } from "@react-three/drei";
import { Suspense, useEffect, useRef, type RefObject } from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";
import { useViewer } from "./state/state";
import { Measurement } from "./components/Measurement";
import { Annotations } from "./components/Annotations";
import { Sidebar } from "./ui/Sidebar";
import type { Annotation, Tool } from "./state/state";
import { Box3 } from "three";

type CameraFocusParams = {
  cameraControlsRef: RefObject<CameraControls | null>;
  focused: Annotation | null;
  focusedId: string | null;
};

const CameraFocus = ({
  cameraControlsRef,
  focused,
  focusedId,
}: CameraFocusParams) => {
  useEffect(() => {
    if (!cameraControlsRef.current) return;
    if (focused) {
      const dist = 3;
      const [px, py, pz] = focused.position;
      const [nx, ny, nz] = focused.normal;
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
  return null;
};

function FrameOnLoad({
  controlsRef,
}: {
  controlsRef: RefObject<CameraControls | null>;
}) {
  const { scene } = useThree();
  useEffect(() => {
    if (!controlsRef.current) return;
    const box = new Box3().setFromObject(scene);
    controlsRef.current.fitToBox(box, true); // frame instantly on load
    controlsRef.current.saveState(); // remember this pose so reset() can restore it later
  }, []);
  return null;
}

function App() {
  const points = useViewer((s) => s.points);
  const annotations = useViewer((s) => s.annotations);
  const setTool = useViewer((s) => s.setTool);
  const focusedId = useViewer((s) => s.focusedId);
  const setFocusedId = useViewer((s) => s.setFocusedId);
  const clearPoints = useViewer((s) => s.clearPoints);

  const cameraControlsRef = useRef<CameraControls | null>(null);

  const focused = annotations.find((a) => a.id === focusedId) ?? null;
  const url = "/models/triceratops_skull.glb";
  const distance = points.length === 2 ? points[0].distanceTo(points[1]) : null;

  return (
    <>
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-10
                flex gap-2 bg-black/70 backdrop-blur rounded-lg p-2
                md:left-4 md:translate-x-0"
      >
        <select onChange={(e) => setTool(e.target.value as Tool)}>
          <option value="orbit">Orbit</option>
          <option value="measure">Measure</option>
          <option value="annotate">Annotate</option>
        </select>
        <button
          onClick={() => {
            setFocusedId(null);
          }}
        >
          Reset Camera
        </button>
        {points.length > 0 && (
          <div>
            <button onClick={clearPoints}>Clear Points</button>
          </div>
        )}
        {distance !== null && (
          <div>
            <h1 className="bg-black/70 text-white px-3 rounded">
              Distance: {distance.toFixed(2) + "m"}
            </h1>
          </div>
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
            <Model url={url} />
            <FrameOnLoad controlsRef={cameraControlsRef} />
            <CameraFocus
              cameraControlsRef={cameraControlsRef}
              focused={focused}
              focusedId={focusedId}
            />
            <Measurement />
            <Annotations />
            <Environment preset="city" />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
    </>
  );
}

export default App;
