import { useGLTF, useHelper } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { Ref } from "react";
import { BoxHelper, Object3D, type Group } from "three";
import { useViewer } from "../state/state";

type ModelParams = {
  ref: Ref<Group> | null;
  url: string;
};

export const Model = ({ ref, url }: ModelParams) => {
  const { scene } = useGLTF(url);
  const addPoint = useViewer((s) => s.addPoint);
  const addAnnotation = useViewer((s) => s.addAnnotation);
  const tool = useViewer((s) => s.tool);

  useHelper(ref as React.RefObject<Object3D>, BoxHelper, "cyan");

  const clickHandler = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point = e.point.clone();
    if (tool === "measure") {
      addPoint(point);
    }
    if (tool === "annotate") {
      let normal: [number, number, number] = [0, 0, 1];
      if (e.face && e.face.normal) {
        const normalVals = e.face.normal.clone();
        normal = [normalVals.x, normalVals.y, normalVals.z];
      }
      const position: [number, number, number] = [point.x, point.y, point.z];
      addAnnotation(position, normal);
    }
  };

  return (
    <>
      <primitive ref={ref} onClick={clickHandler} object={scene} />
    </>
  );
};
