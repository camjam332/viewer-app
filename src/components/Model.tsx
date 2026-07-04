import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useViewer } from "../state/state";

type ModelParams = {
  url: string;
};

export const Model = ({ url }: ModelParams) => {
  const { scene } = useGLTF(url);
  const addPoint = useViewer((s) => s.addPoint);

  const clickHandler = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point = e.point.clone();
    addPoint(point);
  };

  return (
    <>
      <primitive onClick={clickHandler} object={scene} />
    </>
  );
};
