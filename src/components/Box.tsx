import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Mesh } from "three";

export const Box = () => {
  const meshRef = useRef<Mesh | null>(null);

  useFrame((_state, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta;
  });

  return (
    <>
      <mesh ref={meshRef}>
        <boxGeometry />
        <meshStandardMaterial />
      </mesh>
    </>
  );
};
