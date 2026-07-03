import { useGLTF, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { Dispatch, SetStateAction } from "react";
import { Vector3 } from "three";

type ModelParams = {
  url: string;
  points: Vector3[];
  setPoints: Dispatch<SetStateAction<Vector3[]>>;
};

export const Model = ({ url, points, setPoints }: ModelParams) => {
  const { scene } = useGLTF(url);

  const clickHandler = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point = e.point.clone();
    setPoints((prev) => (prev.length === 2 ? [point] : [...prev, point]));
  };

  return (
    <>
      {points.map((v, i) => {
        return (
          <mesh scale={0.1} key={i} position={v}>
            <sphereGeometry />
            <meshStandardMaterial />
          </mesh>
        );
      })}
      {points.length === 2 && <Line points={points} color={"red"} />}
      <primitive onClick={clickHandler} object={scene} />
    </>
  );
};
