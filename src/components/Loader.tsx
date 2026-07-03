import { useProgress, Html } from "@react-three/drei";

export const Loader = () => {
  const { active, progress, errors } = useProgress();

  return (
    <>
      <Html center>
        <h1>Loading {progress}%</h1>
      </Html>
    </>
  );
};
