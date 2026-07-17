import type { CameraControls } from "@react-three/drei";
import { useEffect, type RefObject } from "react";
import { Box3, type Group } from "three";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";

export const FrameOnLoad = ({
  controlsRef,
  modelRef,
  modelUrl,
}: {
  controlsRef: RefObject<CameraControls | null>;
  modelRef: RefObject<Group | null>;
  modelUrl: string | null;
}) => {
  const setMarkerScale = useViewer((s) => s.setMarkerScale);
  const clearPoints = useMeasurement((s) => s.clearPoints);
  useEffect(() => {
    if (!controlsRef.current || !modelRef.current) return;
    controlsRef.current.reset(false);
    const box = new Box3().setFromObject(modelRef.current);
    const markerScale = box.max.x - box.min.x;
    setMarkerScale(markerScale);
    clearPoints();
    controlsRef.current.fitToBox(box, false);
    controlsRef.current.saveState();
  }, [modelUrl]);
  return null;
};
