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
  type Texture,
} from "three";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";
import { useTextureEdit } from "../state/textureEditState";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  drawStroke,
  getTextureCanvas,
  wrapUVCoordinate,
  type PaintPoint,
} from "../utils/texturePaint";

type ModelParams = {
  ref: Ref<Group> | null;
  url: string;
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
// Fraction of the texture's shorter dimension a paint stroke may jump
// between two consecutive samples before it's treated as landing on a
// different UV island rather than a continuation of the same stroke.
const MAX_STROKE_JUMP_RATIO = 0.1;

export const Model = ({ ref, url, onField }: ModelParams) => {
  const { scene } = useGLTF(url);
  const addPoint = useMeasurement((s) => s.addPoint);
  const addAnnotation = useViewer((s) => s.addAnnotation);
  const tool = useViewer((s) => s.tool);
  const invalidate = useThree((s) => s.invalidate);
  const showAero = useViewer((s) => s.showAero);
  const editTexture = useViewer((s) => s.editTexture);
  const activeTextureType = useTextureEdit((s) => s.activeTextureType);
  const brushSize = useTextureEdit((s) => s.brushSize);
  const brushColor = useTextureEdit((s) => s.brushColor);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  const fadeMaterialsRef = useRef<Material[]>([]);
  const fadeElapsedRef = useRef(0);
  const paintStateRef = useRef<{
    textureUuid: string;
    lastPoint: PaintPoint;
  } | null>(null);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  const fieldCacheRef = useRef<{
    source: typeof cloned;
    field: ModelFieldInfo;
  } | null>(null);

  useLayoutEffect(() => {
    const materials: Material[] = [];
    cloned.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
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
    const box = new Box3().setFromObject(cloned);
    const groundOffset = -box.min.y;
    cloned.position.y += groundOffset;
  }, [cloned]);

  useEffect(() => {
    if (!showAero) return;

    const cached = fieldCacheRef.current;
    if (cached && cached.source === cloned) {
      onField(cached.field);
      return;
    }

    // Recompute box post-grounding (cheap; cloned.position is already settled)
    const box = new Box3().setFromObject(cloned);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

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
      if (merged) bvh = new MeshBVH(merged);
    }

    const paddedRadii = new Vector3(
      size.x / 2 + 0.05 * maxDim,
      size.y / 2 + 0.05 * maxDim,
      size.z / 2 + 0.05 * maxDim,
    );

    const field: ModelFieldInfo = {
      center,
      radii: paddedRadii,
      maxRadius: Math.max(paddedRadii.x, paddedRadii.y, paddedRadii.z),
      bvh,
      collisionGeometry: merged,
    };

    // Dispose the previous model's cached collision geometry before replacing it.
    if (cached && cached.source !== cloned) {
      cached.field.collisionGeometry?.dispose();
    }

    fieldCacheRef.current = { source: cloned, field };
    onField(field);
    invalidate();
  }, [cloned, showAero, onField]);

  useEffect(() => {
    return () => {
      fieldCacheRef.current?.field.collisionGeometry?.dispose();
      fieldCacheRef.current = null;
    };
  }, [cloned]);

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

  // Resolves a pointer hit to the mesh's base color texture, the live
  // drawable canvas backing it, and the pixel this hit lands on - or null
  // if the hit doesn't land on a paintable, textured surface.
  const getPaintTarget = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv || !(e.object instanceof Mesh)) return null;
    const mats = Array.isArray(e.object.material)
      ? e.object.material
      : [e.object.material];
    const material = (
      e.face && Array.isArray(e.object.material)
        ? e.object.material[e.face.materialIndex]
        : mats[0]
    ) as Record<string, unknown>;
    const texture = material?.[activeTextureType] as Texture | undefined;
    if (!texture) return null;
    const canvas = getTextureCanvas(texture.uuid);
    if (!canvas) return null;

    const uv = e.uv.clone();
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    uv.applyMatrix3(texture.matrix);
    const wrappedU = wrapUVCoordinate(uv.x, texture.wrapS);
    const wrappedV = wrapUVCoordinate(uv.y, texture.wrapT);
    const point: PaintPoint = {
      x: wrappedU * canvas.width,
      y: (texture.flipY ? 1 - wrappedV : wrappedV) * canvas.height,
    };
    return { texture, canvas, point };
  };

  const stopPainting = () => {
    if (!paintStateRef.current) return;
    paintStateRef.current = null;
    if (controls) controls.enabled = true;
  };

  // Safety net: if the pointer is released off the model/canvas mid-stroke,
  // r3f's onPointerUp/onPointerLeave never fires on this object, which
  // would otherwise leave orbit controls stuck disabled.
  useEffect(() => {
    window.addEventListener("pointerup", stopPainting);
    return () => window.removeEventListener("pointerup", stopPainting);
  }, [controls]);

  const paintDownHandler = (e: ThreeEvent<PointerEvent>) => {
    if (!editTexture) return;
    const target = getPaintTarget(e);
    if (!target) return;
    e.stopPropagation();
    if (controls) controls.enabled = false;
    drawStroke(
      target.canvas,
      target.texture,
      null,
      target.point,
      brushSize,
      brushColor,
    );
    paintStateRef.current = {
      textureUuid: target.texture.uuid,
      lastPoint: target.point,
    };
    invalidate();
  };

  const paintMoveHandler = (e: ThreeEvent<PointerEvent>) => {
    if (!paintStateRef.current) return;
    const target = getPaintTarget(e);
    if (!target) return;
    e.stopPropagation();
    let from =
      target.texture.uuid === paintStateRef.current.textureUuid
        ? paintStateRef.current.lastPoint
        : null;
    if (from) {
      // A smooth drag across a UV seam can still land on a totally
      // different part of the same texture atlas (a different UV island).
      // Connecting that with a straight line draws a streak across
      // unrelated texture regions, so treat implausibly large jumps as the
      // start of a new segment instead.
      const jump = Math.hypot(target.point.x - from.x, target.point.y - from.y);
      const maxJump =
        Math.min(target.canvas.width, target.canvas.height) *
        MAX_STROKE_JUMP_RATIO;
      if (jump > maxJump) from = null;
    }
    drawStroke(
      target.canvas,
      target.texture,
      from,
      target.point,
      brushSize,
      brushColor,
    );
    paintStateRef.current = {
      textureUuid: target.texture.uuid,
      lastPoint: target.point,
    };
    invalidate();
  };

  const clickHandler = (e: ThreeEvent<MouseEvent>) => {
    if (editTexture) return;
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
      <primitive
        ref={ref}
        onClick={clickHandler}
        onPointerDown={paintDownHandler}
        onPointerMove={paintMoveHandler}
        onPointerUp={stopPainting}
        onPointerLeave={stopPainting}
        object={cloned}
      />
    </>
  );
};
