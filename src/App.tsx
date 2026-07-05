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
import type { Tool } from "./state/state";
import { Box3 } from "three";

function FrameOnLoad({
  controlsRef,
}: {
  controlsRef: RefObject<CameraControls | null>;
}) {
  const { scene } = useThree(); // or pass the model's object
  useEffect(() => {
    if (!controlsRef.current) return;
    const box = new Box3().setFromObject(scene);
    controlsRef.current.fitToBox(box, true); // frame the whole model, animated
  }, []);
  return null;
}

function App() {
  const points = useViewer((s) => s.points);
  const annotations = useViewer((s) => s.annotations);
  const setTool = useViewer((s) => s.setTool);
  const selectedId = useViewer((s) => s.selectedId);
  const clearPoints = useViewer((s) => s.clearPoints);
  const cameraControlsRef = useRef<CameraControls | null>(null);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  const url = "/models/triceratops_skull.glb";
  const distance = points.length === 2 ? points[0].distanceTo(points[1]) : null;

  useEffect(() => {
    if (!cameraControlsRef.current || !selected) return;

    const dist = 3;
    const [px, py, pz] = selected.position;
    const [nx, ny, nz] = selected.normal ?? [0, 0, 1];
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
  }, [selectedId]);

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 64,
          right: 16,
          zIndex: 1,
        }}
      >
        <select onChange={(e) => setTool(e.target.value as Tool)}>
          <option value="orbit">Orbit</option>
          <option value="measure">Measure</option>
          <option value="annotate">Annotate</option>
        </select>
      </div>
      {points.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 1,
          }}
        >
          <button onClick={clearPoints}>Clear Points</button>
        </div>
      )}
      {distance !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            zIndex: 1,
            color: "black",
          }}
        >
          <h1>Distance: {distance.toFixed(2) + "m"}</h1>
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
