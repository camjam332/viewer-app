import { Line } from "@react-three/drei";
import { useMeasurement } from "../state/measurementState";
import { useViewer } from "../state/state";

export const Measurement = () => {
  const points = useMeasurement((s) => s.points);
  const markerScale = useViewer((s) => s.markerScale);

  return (
    <>
      {points.map((v, i) => {
        return (
          <mesh scale={0.01 * markerScale} key={i} position={v}>
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
