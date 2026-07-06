import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useRef, type Ref } from "react";
import { Mesh, Vector3, type Group, type Material } from "three";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";

type ModelParams = {
  ref: Ref<Group> | null;
  url: string | null;
};

const FADE_IN_SECONDS = 1.0;

export const Model = ({ ref, url }: ModelParams) => {
  if (!url) return;
  const { scene } = useGLTF(url);
  const addPoint = useMeasurement((s) => s.addPoint);

  const addAnnotation = useViewer((s) => s.addAnnotation);
  const tool = useViewer((s) => s.tool);
  const invalidate = useThree((s) => s.invalidate);

  const fadeMaterialsRef = useRef<Material[]>([]);
  const fadeElapsedRef = useRef(0);

  // Start every material fully transparent so the model doesn't flash in at
  // full opacity before the fade-in below gets a chance to run.
  useLayoutEffect(() => {
    const materials: Material[] = [];
    const meshes: Mesh[] = [];
    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      meshes.push(obj);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        mat.transparent = true;
        mat.opacity = 0;
        materials.push(mat);
      }
    });
    fadeMaterialsRef.current = materials;
    fadeElapsedRef.current = 0;
    invalidate();
  }, [scene, invalidate]);

  useFrame((_, delta) => {
    if (fadeElapsedRef.current >= FADE_IN_SECONDS) {
      for (const mat of fadeMaterialsRef.current) {
        mat.transparent = false;
      }
      return;
    }
    fadeElapsedRef.current += delta;
    const t = Math.min(fadeElapsedRef.current / FADE_IN_SECONDS, 1);
    for (const mat of fadeMaterialsRef.current) {
      mat.opacity = t;
    }
    if (t < 1) invalidate(); // frameloop="demand" needs a nudge each step
  });

  const clickHandler = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point = e.point.clone();
    if (tool === "measure") {
      addPoint(point);
    }
    if (tool === "annotate") {
      let normal: [number, number, number] = [0, 0, 1];
      if (e.face && e.face.normal) {
        const normalVals = e.face.normal
          .clone()
          .transformDirection(e.object.matrixWorld);
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
