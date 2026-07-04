import { Canvas } from "@react-three/fiber";
import { Model } from "./components/Model";
import { Bounds, Html, OrbitControls, Environment } from "@react-three/drei";
import { Suspense } from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";
import { useViewer } from "./state/state";
import { Measurement } from "./components/Measurement";
import { Annotations } from "./components/Annotations";
import { Sidebar } from "./ui/Sidebar";
import type { Tool } from "./state/state";

function App() {
  const points = useViewer((s) => s.points);
  const setTool = useViewer((s) => s.setTool);
  const clearPoints = useViewer((s) => s.clearPoints);
  const url = "/models/triceratops_skull.glb";
  const distance = points.length === 2 ? points[0].distanceTo(points[1]) : null;

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
        camera={{ position: [0, 0, 10] }}
      >
        <OrbitControls makeDefault enableDamping />
        <ErrorBoundary
          fallbackRender={({ error }) => (
            <Html center>
              <h1>Failed to load model: {(error as Error).message}</h1>
            </Html>
          )}
        >
          <Suspense fallback={<Loader />}>
            <Bounds fit clip observe>
              <Model url={url} />
              <Measurement />
              <Annotations />
            </Bounds>
            <Environment preset="city" />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
    </>
  );
}

export default App;
