import { useViewer } from "../state/state";
import { Line } from "@react-three/drei";

export const Measurement = () => {
  const points = useViewer((s) => s.points);

  return (
    <>
      {points.map((v, i) => {
        return (
          <mesh scale={0.1} key={i} position={v}>
            <sphereGeometry />
            <meshBasicMaterial color={"red"} depthTest={false} />
          </mesh>
        );
      })}
      {points.length === 2 && (
        <Line points={points} color={"red"} depthTest={false} />
      )}
    </>
  );
};
