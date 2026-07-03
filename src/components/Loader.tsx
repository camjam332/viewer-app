import { useProgress, Html } from "@react-three/drei";

export const Loader = () => {
  const { progress } = useProgress();

  return (
    <>
      <Html center>
        <h1>Loading {progress}%</h1>
      </Html>
    </>
  );
};
