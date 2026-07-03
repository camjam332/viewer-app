import { Canvas } from "@react-three/fiber";
import { Box } from "./components/Box";
function App() {
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
      >
        <ambientLight />
        <directionalLight />
        <Box />
      </Canvas>
    </>
  );
}

export default App;
