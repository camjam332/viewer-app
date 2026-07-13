import type { SplatMesh } from "@sparkjsdev/spark";
import { MathUtils, Quaternion, Vector3 } from "three";
import type { CameraControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { RefObject } from "react";
import type { ModelOption } from "../../ui/ModelPicker";
import type { Tool } from "../../state/state";
import { applyMatrix4ToFlatPoints } from "../measurement_utils";

// Same plain-function pattern as mkkellogSplat_utils.ts, for the same
// reason - useCallback can't be called at module scope, so the actual
// useCallback wrapping (and its dependency array) stays in App.tsx.

/**
 * Extracts every splat's world-space center into a flat, interleaved xyz
 * Float32Array - the same shape buildSplatGraph/geodesicWorker.ts already
 * expect, and the same shape extractSparkSplatCenters's GaussianSplats3D
 * equivalent (fillSplatDataArrays) produced. Uses forEachSplat (the same
 * bulk-iteration method getBoundingBox() itself uses internally) rather
 * than looping packedSplats.getSplat(i) manually - not because the latter
 * wouldn't work, just consistent with how the library's own code does
 * full-scene iteration.
 *
 * Local/object-space centers - matrixWorld is applied afterward, same
 * pattern as getBoundingBox()'s usage in handleSparkSplatLoad.
 */
export function extractSparkSplatCenters(splatMesh: SplatMesh): Float32Array {
  const numSplats = splatMesh.packedSplats?.numSplats ?? 0;
  const centers = new Float32Array(numSplats * 3);

  let i = 0;
  splatMesh.packedSplats?.forEachSplat((_index, center) => {
    centers[i * 3] = center.x;
    centers[i * 3 + 1] = center.y;
    centers[i * 3 + 2] = center.z;
    i++;
  });

  splatMesh.updateMatrixWorld(true);
  applyMatrix4ToFlatPoints(centers, splatMesh.matrixWorld.elements);

  return centers;
}

export type HandleSparkSplatLoadDeps = {
  cameraControlsRef: RefObject<CameraControls | null>;
  selectedModel: ModelOption | undefined;
  setMarkerScale: (scale: number) => void;
  clearPoints: () => void;
  setLoadedSplatMesh: (mesh: SplatMesh | null) => void;
  setSplatCenters: (centers: Float32Array | null) => void;
};

export function handleSparkSplatLoad(
  splatMesh: SplatMesh,
  deps: HandleSparkSplatLoadDeps,
): void {
  const {
    cameraControlsRef,
    selectedModel,
    setMarkerScale,
    clearPoints,
    setLoadedSplatMesh,
    setSplatCenters,
  } = deps;

  if (!cameraControlsRef.current) return;

  const viewMode = selectedModel?.splatViewMode ?? "object";

  if (viewMode === "interior") {
    splatMesh.quaternion.premultiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        MathUtils.degToRad(180),
      ),
    );
    splatMesh.updateMatrixWorld(true);
  }

  // centers_only=false accounts for each splat's actual ellipsoid extent
  // (rotated + scaled per-splat), not just its center point - a more
  // generous box than centers-only, matching what fitToBox actually needs
  // to avoid clipping visible content near the scene's edges. Returns
  // local/object-space bounds - matrixWorld still needs applying manually,
  // same pattern as computeBoundingBox() did for GaussianSplats3D.
  const box = splatMesh
    .getBoundingBox(false)
    .applyMatrix4(splatMesh.matrixWorld);

  setMarkerScale(box.max.x - box.min.x);
  clearPoints();

  if (viewMode === "interior") {
    cameraControlsRef.current.setLookAt(0, 0, 0, 0, 0, 1, false);
  } else {
    cameraControlsRef.current.reset(false);
    cameraControlsRef.current.fitToBox(box, false);
  }

  cameraControlsRef.current.saveState();
  setLoadedSplatMesh(splatMesh);
  setSplatCenters(extractSparkSplatCenters(splatMesh));
}

/**
 * Estimates a surface normal near a clicked world-space point, for
 * annotation placement. Spark's native raycast only returns
 * {distance, point, object} - no normal, no per-splat index the way
 * GaussianSplats3D's raycaster gave us. This substitutes: find the
 * nearest splat to the click (a plain linear scan over the already-
 * extracted, already-world-space splatCenters array - no k-d tree build
 * needed for a query this occasional, one per click, versus the
 * repeated queries buildSplatGraph does), then use that single splat's
 * own shape - its shortest local scale axis, rotated into world space -
 * as a per-splat local-flatness estimate. Same reasoning as
 * detectOrientation's up-axis detection, just for one splat instead of
 * an aggregate over many.
 *
 * Sign is ambiguous for any single splat's short axis (could point
 * either way) - resolved by flipping the normal to face the camera,
 * which conveniently also matches what CameraFocus actually wants:
 * annotations should focus-camera from roughly the direction you were
 * looking when you placed them.
 *
 * Only calls the (allocating, decoding) getSplat() once, for the winning
 * index - the search loop itself is plain float comparisons against the
 * pre-extracted array, no per-iteration allocation.
 */
export function estimateSparkSplatNormal(
  splatMesh: SplatMesh,
  splatCenters: Float32Array,
  worldPoint: Vector3,
  cameraPosition: Vector3,
): Vector3 {
  const count = splatCenters.length / 3;
  if (count === 0 || !splatMesh.packedSplats) return new Vector3(0, 0, 1);

  let closestIndex = -1;
  let closestDistSq = Infinity;
  const { x, y, z } = worldPoint;
  for (let i = 0; i < count; i++) {
    const dx = splatCenters[i * 3] - x;
    const dy = splatCenters[i * 3 + 1] - y;
    const dz = splatCenters[i * 3 + 2] - z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < closestDistSq) {
      closestDistSq = distSq;
      closestIndex = i;
    }
  }
  if (closestIndex === -1) return new Vector3(0, 0, 1);

  const splat = splatMesh.packedSplats.getSplat(closestIndex);
  const sx = splat.scales.x,
    sy = splat.scales.y,
    sz = splat.scales.z;
  const localAxis = new Vector3();
  if (sx <= sy && sx <= sz) localAxis.set(1, 0, 0);
  else if (sy <= sx && sy <= sz) localAxis.set(0, 1, 0);
  else localAxis.set(0, 0, 1);

  const worldQuat = new Quaternion().setFromRotationMatrix(
    splatMesh.matrixWorld,
  );
  const normal = localAxis
    .applyQuaternion(splat.quaternion)
    .applyQuaternion(worldQuat)
    .normalize();

  const towardCamera = cameraPosition.clone().sub(worldPoint);
  if (normal.dot(towardCamera) < 0) normal.negate();

  return normal;
}

export type SplatClickDeps = {
  tool: Tool;
  addPoint: (point: Vector3) => void;
  addAnnotation: (
    position: [number, number, number],
    normal: [number, number, number],
    modelUrl?: string,
  ) => void;
  effectiveModelUrl: string | null;
  splatCenters: Float32Array | null;
};

export function handleSparkSplatClick(
  event: ThreeEvent<MouseEvent>,
  splatMesh: SplatMesh,
  deps: SplatClickDeps,
): void {
  const { tool, addPoint, addAnnotation, effectiveModelUrl, splatCenters } =
    deps;

  if (tool === "measure") {
    addPoint(event.point.clone());
    return;
  }

  if (tool === "annotate") {
    let normal: [number, number, number] = [0, 0, 1];
    if (splatCenters && splatCenters.length > 0) {
      const n = estimateSparkSplatNormal(
        splatMesh,
        splatCenters,
        event.point,
        event.camera.position,
      );
      normal = [n.x, n.y, n.z];
    }
    addAnnotation(
      [event.point.x, event.point.y, event.point.z],
      normal,
      effectiveModelUrl ?? undefined,
    );
  }
}
