import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useViewer } from "../state/state";

type ModelParams = {
  url: string;
};

export const Model = ({ url }: ModelParams) => {
  const { scene } = useGLTF(url);
  const addPoint = useViewer((s) => s.addPoint);
  const addAnnotation = useViewer((s) => s.addAnnotation);
  const tool = useViewer((s) => s.tool);

  const clickHandler = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point = e.point.clone();
    if (tool === "measure") {
      addPoint(point);
    }
    if (tool === "annotate") {
      const position: [number, number, number] = [point.x, point.y, point.z];
      addAnnotation(position);
    }
  };

  return (
    <>
      <primitive onClick={clickHandler} object={scene} />
    </>
  );
};
