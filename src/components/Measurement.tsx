import { Line } from "@react-three/drei";
import { useMeasurement } from "../state/measurementState";
import { useViewer } from "../state/state";
import { Box3, Object3D, Raycaster, Vector3 } from "three";
import { useEffect, useMemo, type RefObject } from "react";

type MeasurementProps = {
  modelRef: RefObject<Object3D | null>;
};

export const Measurement = ({ modelRef }: MeasurementProps) => {
  const points = useMeasurement((s) => s.points);
  const setSurfaceDistance = useMeasurement((s) => s.setSurfaceDistance);
  const markerScale = useViewer((s) => s.markerScale);

  const straight = points.length === 2 ? points[0].distanceTo(points[1]) : null;

  const draped = useMemo(() => {
    if (points.length !== 2 || !modelRef.current) return null;

    const [a, b] = points;
    const model = modelRef.current;

    // find a Y above the whole model to cast down from
    const box = new Box3().setFromObject(model);
    const topY = box.max.y + 1;

    const raycaster = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const N = 40;
    const drapedPoints: Vector3[] = [];

    for (let i = 0; i <= N; i++) {
      const sample = new Vector3().lerpVectors(a, b, i / N); // point along straight line
      raycaster.set(new Vector3(sample.x, topY, sample.z), down); // origin above, cast down
      const hit = raycaster.intersectObject(model, true)[0];
      drapedPoints.push(hit ? hit.point.clone() : sample); // surface hit, or fall back
    }

    // sum the draped segments
    let dist = 0;
    for (let i = 1; i < drapedPoints.length; i++) {
      dist += drapedPoints[i].distanceTo(drapedPoints[i - 1]);
    }

    return { points: drapedPoints, distance: dist };
  }, [points, modelRef]);

  useEffect(() => {
    setSurfaceDistance(draped?.distance ?? null);
  }, [draped, setSurfaceDistance]);

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

      {draped && (
        <Line
          points={draped.points}
          color="cyan"
          depthTest={false}
          lineWidth={2}
        />
      )}
    </>
  );
};
