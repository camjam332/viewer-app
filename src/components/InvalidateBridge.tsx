import { useThree } from "@react-three/fiber";
import { useViewer } from "../state/state";
import { useEffect } from "react";
import { registerRenderer } from "../utils/texturePaint";

export const InvalidateBridge = () => {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const setRequestRender = useViewer((s) => s.setRequestRender);
  useEffect(() => {
    setRequestRender(invalidate);
  }, [invalidate, setRequestRender]);
  useEffect(() => {
    registerRenderer(gl);
  }, [gl]);
  return null;
};
