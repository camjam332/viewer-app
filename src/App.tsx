import { Canvas } from "@react-three/fiber";
import { Model } from "./components/Model";
import { Bounds, Html, OrbitControls, Environment } from "@react-three/drei";
import { Suspense, useState } from "react";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "react-error-boundary";

function App() {
  const url = "/models/triceratops_skull.glb";
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        <ambientLight />
        <directionalLight />
        <Environment background preset="city" />
        <ErrorBoundary
          fallback={
            <Html>
              <h1>{errorMessage}</h1>
            </Html>
          }
          onError={(error) => setErrorMessage((error as Error).message)}
        >
          <Suspense fallback={<Loader />}>
            <Bounds fit clip observe>
              <Model url={url} />
            </Bounds>
          </Suspense>
        </ErrorBoundary>
      </Canvas>
    </>
  );
}

export default App;
