import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type Ref } from "react";
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Mesh,
  Vector2,
  Vector3,
  type BufferAttribute,
  type Group,
  type Material,
  type Texture,
} from "three";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";
import { useTextureEdit } from "../state/textureEditState";
import {
  MeshBVH,
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  beginPaintSession,
  drawStroke,
  endPaintSession,
  getTextureCanvas,
  wrapUVCoordinate,
  type PaintPoint,
} from "../utils/texturePaint";

// r3f raycasts every intersectable mesh under the pointer on every single
// pointermove (to know what to dispatch onPointerMove/Over/Out to), using
// three.js's default brute-force per-triangle Mesh.raycast otherwise. For a
// high-poly scan (hundreds of thousands+ triangles) that's expensive enough
// per call to show up as dropped frames just from moving the mouse, even
// with no click/drag involved. This swaps in three-mesh-bvh's accelerated
// raycast globally - geometries still need computeBoundsTree() called once
// (see the effect below) before it actually kicks in for a given mesh.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

type ModelParams = {
  ref: Ref<Group> | null;
  url: string;
  onField: (f: ModelFieldInfo) => void;
  // Fires once per newly-loaded model, after the ref is genuinely
  // attached - Measurement.tsx's mesh graph effect needs this to know
  // when modelRef.current has actually become valid. modelUrl itself
  // changes earlier, at selection time, before Suspense has resolved
  // and before <primitive ref={ref}> below has actually mounted - an
  // effect keyed on modelUrl alone would run too early and never get a
  // second chance to see the ref once it's real. Optional since not
  // every caller of Model needs to know this.
  onReady?: () => void;
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

export const Model = ({ ref, url, onField, onReady }: ModelParams) => {
  const { scene } = useGLTF(url);
  const addPoint = useMeasurement((s) => s.addPoint);
  const addAnnotation = useViewer((s) => s.addAnnotation);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  const tool = useViewer((s) => s.tool);
  const showAero = useViewer((s) => s.showAero);
  const editTexture = useViewer((s) => s.editTexture);
  const activeTextureType = useTextureEdit((s) => s.activeTextureType);
  const brushSize = useTextureEdit((s) => s.brushSize);
  const brushColor = useTextureEdit((s) => s.brushColor);
  const paintTool = useTextureEdit((s) => s.tool);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  const fadeMaterialsRef = useRef<Material[]>([]);
  const fadeElapsedRef = useRef(0);
  const brushCursorRef = useRef<Mesh>(null);
  const paintStateRef = useRef<{
    texture: Texture;
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

  // Builds the per-mesh acceleration structure the raycast override above
  // actually needs to kick in (it silently falls back to the slow default
  // for any geometry without one). Deferred to useEffect rather than
  // useLayoutEffect since building it can itself take a noticeable moment
  // on a dense scan - fine as a one-time background cost after the model's
  // already painted, not worth blocking the first frame for.
  useEffect(() => {
    cloned.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const geometry = obj.geometry;
      if (!geometry.boundsTree) geometry.computeBoundsTree();
    });
  }, [cloned]);

  useEffect(() => {
    const box = new Box3().setFromObject(cloned);
    const groundOffset = -box.min.y;
    cloned.position.y += groundOffset;
  }, [cloned]);

  // Fires after this render has committed, by which point <primitive
  // ref={ref}> below has actually mounted - unlike modelUrl (which
  // changes at selection time, before Suspense resolves), this is a
  // reliable "the ref is genuinely valid now" signal for callers that
  // need to react to that specifically, not just to url changing.
  useEffect(() => {
    onReady?.();
  }, [cloned, onReady]);

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

  // Brush size is defined in texture-pixel units, and texel density (world
  // units covered per UV unit) varies per mesh/triangle - so a fixed-size
  // cursor wouldn't actually represent what's about to get painted. This
  // derives the local UV-to-world scale from the hit triangle (the same
  // tangent/bitangent math used for normal mapping) and uses it to convert
  // the brush's pixel radius into a world-space radius at that exact spot.
  const computeWorldBrushRadius = (
    object: Mesh,
    face: { a: number; b: number; c: number },
    canvas: HTMLCanvasElement,
    brushSizePixels: number,
  ): number => {
    const uvAttr = object.geometry.attributes.uv;
    const posAttr = object.geometry.attributes.position;
    if (!uvAttr) return 0;

    const p0 = new Vector3()
      .fromBufferAttribute(posAttr, face.a)
      .applyMatrix4(object.matrixWorld);
    const p1 = new Vector3()
      .fromBufferAttribute(posAttr, face.b)
      .applyMatrix4(object.matrixWorld);
    const p2 = new Vector3()
      .fromBufferAttribute(posAttr, face.c)
      .applyMatrix4(object.matrixWorld);

    const uv0 = new Vector2().fromBufferAttribute(
      uvAttr as BufferAttribute,
      face.a,
    );
    const uv1 = new Vector2().fromBufferAttribute(
      uvAttr as BufferAttribute,
      face.b,
    );
    const uv2 = new Vector2().fromBufferAttribute(
      uvAttr as BufferAttribute,
      face.c,
    );

    const e1 = p1.clone().sub(p0);
    const e2 = p2.clone().sub(p0);
    const duv1 = uv1.clone().sub(uv0);
    const duv2 = uv2.clone().sub(uv0);

    const det = duv1.x * duv2.y - duv2.x * duv1.y;
    if (Math.abs(det) < 1e-8) return 0;
    const invDet = 1 / det;

    const tangent = e1
      .clone()
      .multiplyScalar(duv2.y)
      .addScaledVector(e2, -duv1.y)
      .multiplyScalar(invDet);
    const bitangent = e2
      .clone()
      .multiplyScalar(duv1.x)
      .addScaledVector(e1, -duv2.x)
      .multiplyScalar(invDet);

    const worldPerUV = (tangent.length() + bitangent.length()) / 2;
    const brushRadiusUV =
      brushSizePixels / 2 / ((canvas.width + canvas.height) / 2);
    return worldPerUV * brushRadiusUV;
  };

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

  // Updates the ring mesh that previews the brush's footprint on the
  // surface under the cursor. Mutated imperatively via ref (not React
  // state) since this runs on every pointermove.
  const updateBrushCursor = (
    target: ReturnType<typeof getPaintTarget>,
    e: ThreeEvent<PointerEvent>,
  ) => {
    const cursorMesh = brushCursorRef.current;
    if (!cursorMesh) return;
    if (!target || !e.face || !(e.object instanceof Mesh)) {
      cursorMesh.visible = false;
      invalidate();
      return;
    }
    const radius = computeWorldBrushRadius(
      e.object,
      e.face,
      target.canvas,
      brushSize,
    );
    if (radius <= 0) {
      cursorMesh.visible = false;
      invalidate();
      return;
    }
    const worldNormal = e.face.normal
      .clone()
      .transformDirection(e.object.matrixWorld);
    cursorMesh.position.copy(e.point);
    cursorMesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), worldNormal);
    cursorMesh.scale.setScalar(radius);
    cursorMesh.visible = true;
    invalidate();
  };

  const hideBrushCursor = () => {
    if (brushCursorRef.current) brushCursorRef.current.visible = false;
    invalidate();
  };

  useEffect(() => {
    if (!editTexture) hideBrushCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTexture]);

  const stopPainting = () => {
    if (!paintStateRef.current) return;
    endPaintSession(paintStateRef.current.texture);
    paintStateRef.current = null;
    if (controls) controls.enabled = true;
    invalidate();
  };

  // Safety net: if the pointer is released off the model/canvas mid-stroke,
  // r3f's onPointerUp never fires on this object, which would otherwise
  // leave orbit controls stuck disabled. (There's deliberately no
  // onPointerLeave here: with several meshes sharing one handler, r3f fires
  // it the instant the ray crosses from one child mesh to another, which
  // would kill the stroke every time a drag crosses a mesh boundary.)
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
    // camera-controls clears touch-action back to "" the instant it's
    // disabled (see its `enabled` setter) - on mobile that hands the
    // in-progress finger drag straight to the browser's native
    // scroll/pan gesture recognizer mid-stroke. Force it back so the
    // canvas stays non-scrollable for the duration of the paint drag.
    gl.domElement.style.touchAction = "none";
    beginPaintSession(target.texture);
    drawStroke(
      target.canvas,
      target.texture,
      null,
      target.point,
      brushSize,
      brushColor,
      paintTool === "eraser",
    );
    paintStateRef.current = {
      texture: target.texture,
      lastPoint: target.point,
    };
    invalidate();
  };

  const paintMoveHandler = (e: ThreeEvent<PointerEvent>) => {
    if (!editTexture) return;
    const target = getPaintTarget(e);
    if (target) e.stopPropagation();
    updateBrushCursor(target, e);

    // Multiple meshes under the same ray (common when several share a
    // texture) can each dispatch this handler within a single native
    // pointer event. Capture the ref's value once so a paintStateRef
    // mutation from another dispatch in that same batch (e.g. stopPainting
    // firing for a mesh that's no longer intersected) can't null it out
    // between this check and its later use below.
    const paintState = paintStateRef.current;
    if (!paintState || !target) return;
    const sameTexture = target.texture.uuid === paintState.texture.uuid;
    let from = sameTexture ? paintState.lastPoint : null;
    if (from) {
      // A smooth drag across a UV seam can still land on a totally
      // different part of the same texture atlas (a different UV
      // island). Connecting that with a straight line draws a streak
      // across unrelated texture regions, so treat implausibly large
      // jumps as the start of a new segment instead.
      const jump = Math.hypot(target.point.x - from.x, target.point.y - from.y);
      const maxJump =
        Math.min(target.canvas.width, target.canvas.height) *
        MAX_STROKE_JUMP_RATIO;
      if (jump > maxJump) from = null;
    }
    if (!sameTexture) {
      endPaintSession(paintState.texture);
      beginPaintSession(target.texture);
    }
    drawStroke(
      target.canvas,
      target.texture,
      from,
      target.point,
      brushSize,
      brushColor,
      paintTool === "eraser",
    );
    paintStateRef.current = {
      texture: target.texture,
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
        onPointerLeave={hideBrushCursor}
        object={cloned}
      />
      <mesh ref={brushCursorRef} visible={false} raycast={() => null}>
        <ringGeometry args={[0.85, 1, 48]} />
        <meshBasicMaterial
          color="white"
          side={DoubleSide}
          transparent
          opacity={0.85}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </>
  );
};
