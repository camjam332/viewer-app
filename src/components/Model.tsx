import { useGLTF } from "@react-three/drei";

type ModelParams = {
  url: string;
};

export const Model = ({ url }: ModelParams) => {
  const { scene } = useGLTF(url);

  return <primitive object={scene} />;
};
