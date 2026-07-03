import { Canvas } from "@react-three/fiber";
import { Model } from "./components/Model";
import { Bounds, Html, OrbitControls, Environment } from "@react-three/drei";
import { Suspense } from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";

function App() {
  const url = "/models/triceratops_skull.glb";

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
              <Model url={url} />
            </Bounds>
            <Environment background preset="city" />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
    </>
  );
}

export default App;
