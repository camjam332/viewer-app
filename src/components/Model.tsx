import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type Ref } from "react";
import {
  Box3,
  BufferGeometry,
  Mesh,
  Vector3,
  type Group,
  type Material,
} from "three";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type ModelParams = {
  ref: Ref<Group> | null;
  url: string | null;
  onField: (f: ModelFieldInfo) => void;
};

export type ModelFieldInfo = {
  center: Vector3;
  radii: Vector3;
  maxRadius: number;
  bvh: MeshBVH | null;
  collisionGeometry: BufferGeometry | null;
};

const FADE_IN_SECONDS = 1.0;

export const Model = ({ ref, url, onField }: ModelParams) => {
  if (!url) return;
  const { scene } = useGLTF(url);
  const addPoint = useMeasurement((s) => s.addPoint);

  const addAnnotation = useViewer((s) => s.addAnnotation);
  const tool = useViewer((s) => s.tool);
  const invalidate = useThree((s) => s.invalidate);
  const showAero = useViewer((s) => s.showAero);

  const fadeMaterialsRef = useRef<Material[]>([]);
  const fadeElapsedRef = useRef(0);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    const materials: Material[] = [];
    const meshes: Mesh[] = [];
    cloned.traverse((obj) => {
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
  }, [cloned, invalidate]);

  useEffect(() => {
    if (showAero) {
      const box = new Box3().setFromObject(cloned);
      const size = new Vector3();
      const center = new Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 2 / maxDim;
      const strippedGeometries: BufferGeometry[] = [];
      cloned.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!(mesh as any).isMesh) return;
        const geom = mesh.geometry.clone();
        geom.applyMatrix4(mesh.matrixWorld);
        if (!geom.attributes.normal) geom.computeVertexNormals();
        const stripped = new BufferGeometry();
        stripped.setAttribute("position", geom.attributes.position);
        stripped.setAttribute("normal", geom.attributes.normal);
        if (geom.index) stripped.setIndex(geom.index);
        strippedGeometries.push(stripped);
      });
      let bvh: MeshBVH | null = null;
      let merged: BufferGeometry | null = null;
      if (strippedGeometries.length > 0) {
        merged = mergeGeometries(strippedGeometries, false);
        if (merged) {
          bvh = new MeshBVH(merged);
        }
      }
      const paddedRadii = new Vector3(
        (size.x * scale) / 2,
        (size.y * scale) / 2,
        (size.z * scale) / 2,
      );
      onField({
        center,
        radii: paddedRadii,
        maxRadius: Math.max(paddedRadii.x, paddedRadii.y, paddedRadii.z),
        bvh,
        collisionGeometry: merged,
      });
      invalidate();
    }
  }, [cloned, showAero, onField]);

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
      addAnnotation(position, normal, url ?? undefined);
    }
  };

  return (
    <>
      <primitive ref={ref} onClick={clickHandler} object={cloned} />
    </>
  );
};
