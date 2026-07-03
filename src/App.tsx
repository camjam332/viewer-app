import { Canvas } from "@react-three/fiber";
import { Model } from "./components/Model";
import { Bounds, Html, OrbitControls, Environment } from "@react-three/drei";
import { Suspense, useState } from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";
import type { Vector3 } from "three";

function App() {
  const url = "/models/triceratops_skull.glb";
  const [points, setPoints] = useState<Vector3[]>([]);
  const distance = points.length === 2 ? points[0].distanceTo(points[1]) : null;

  return (
    <>
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
              <Model url={url} points={points} setPoints={setPoints} />
            </Bounds>
            <Environment preset="city" />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
      {distance !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            color: "black",
            pointerEvents: "none",
          }}
        >
          <h1>Distance: {distance.toFixed(2)}</h1>
        </div>
      )}
    </>
  );
}

export default App;
