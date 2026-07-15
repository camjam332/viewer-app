import type { SplatMesh } from "@sparkjsdev/spark";
import { Quaternion, Vector3 } from "three";
import type { CameraControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { RefObject } from "react";
import type { ModelOption } from "../../ui/ModelPicker";
import type { Tool } from "../../state/state";
import {
  detectOrientationFromSamples,
  type SplatOrientationSamples,
} from "../splatOrientation_utils";

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
/**
 * Asynchronously extracts splat centers off the main thread using a Web Worker.
 */
export function extractSparkSplatCentersAsync(
  splatMesh: SplatMesh,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
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
    const matrixElements = Array.from(splatMesh.matrixWorld.elements);

    // Spin up the worker
    const worker = new Worker(
      new URL("./splatCenters.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent<Float32Array>) => {
      resolve(e.data);
      worker.terminate(); // Clean up thread resources
    };

    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    // The second array transfers ownership of the underlying buffer
    // ensuring the main thread doesn't lock up duplicating memory blocks.
    worker.postMessage({ centers, matrixElements }, [centers.buffer]);
  });
}

/**
 * Samples up to sampleCount splats (evenly strided across the full set)
 * and produces world-space centers + normals for
 * detectOrientationFromSamples. One getSplat() call per sample gives
 * center+scales+quaternion together - simpler than GaussianSplats3D's
 * two-call pattern (getSplatCenter + getSplatScaleAndRotation), though
 * unlike that library's applySceneTransform option, Spark's getSplat()
 * always returns local/object-space data - matrixWorld's rotation and
 * translation are applied manually here instead.
 *
 * Deliberately called BEFORE any orientation correction is applied to the
 * SplatMesh (i.e. while its matrixWorld is still whatever it started at,
 * normally identity) - this samples the scene's raw, as-loaded
 * orientation to compute a correction, not an already-corrected one.
 */
export function sampleSparkSplatOrientation(
  splatMesh: SplatMesh,
  sampleCount = 20000,
): SplatOrientationSamples {
  const totalSplats = splatMesh.packedSplats?.numSplats ?? 0;
  if (totalSplats === 0 || !splatMesh.packedSplats) {
    return { centers: new Float32Array(0), normals: new Float32Array(0) };
  }

  const step = Math.max(1, Math.floor(totalSplats / sampleCount));
  const sampleIndices: number[] = [];
  for (let i = 0; i < totalSplats; i += step) sampleIndices.push(i);

  const centers = new Float32Array(sampleIndices.length * 3);
  const normals = new Float32Array(sampleIndices.length * 3);

  splatMesh.updateMatrixWorld(true);
  const worldQuat = new Quaternion().setFromRotationMatrix(
    splatMesh.matrixWorld,
  );
  const localAxis = new Vector3();
  const worldNormal = new Vector3();
  const worldCenter = new Vector3();

  for (let s = 0; s < sampleIndices.length; s++) {
    const splat = splatMesh.packedSplats.getSplat(sampleIndices[s]);

    const sx = splat.scales.x,
      sy = splat.scales.y,
      sz = splat.scales.z;
    if (sx <= sy && sx <= sz) localAxis.set(1, 0, 0);
    else if (sy <= sx && sy <= sz) localAxis.set(0, 1, 0);
    else localAxis.set(0, 0, 1);

    worldNormal
      .copy(localAxis)
      .applyQuaternion(splat.quaternion)
      .applyQuaternion(worldQuat);
    if (worldNormal.lengthSq() > 1e-12) {
      worldNormal.normalize();
      normals[s * 3] = worldNormal.x;
      normals[s * 3 + 1] = worldNormal.y;
      normals[s * 3 + 2] = worldNormal.z;
    } // else leave as (0,0,0) - the degenerate "skip" marker

    worldCenter.copy(splat.center).applyMatrix4(splatMesh.matrixWorld);
    centers[s * 3] = worldCenter.x;
    centers[s * 3 + 1] = worldCenter.y;
    centers[s * 3 + 2] = worldCenter.z;
  }

  return { centers, normals };
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
    const orientation = detectOrientationFromSamples(
      sampleSparkSplatOrientation(splatMesh),
    );
    splatMesh.quaternion.copy(orientation);
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
  extractSparkSplatCentersAsync(splatMesh)
    .then((calculatedCenters) => {
      setSplatCenters(calculatedCenters);
    })
    .catch((error) => {
      console.error("Failed to extract splat centers off-thread:", error);
    });
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
  splatCentersRef: RefObject<Float32Array<ArrayBufferLike> | null>;
};

export function handleSparkSplatClick(
  event: ThreeEvent<MouseEvent>,
  splatMesh: SplatMesh,
  deps: SplatClickDeps,
): void {
  const { tool, addPoint, addAnnotation, effectiveModelUrl, splatCentersRef } =
    deps;

  if (tool === "measure") {
    const point = event.point.clone();
    addPoint(point);
    return;
  }

  if (tool === "annotate") {
    let normal: [number, number, number] = [0, 0, 1];
    const point = event.point.clone();
    if (splatCentersRef.current && splatCentersRef.current.length > 0) {
      const n = estimateSparkSplatNormal(
        splatMesh,
        splatCentersRef.current,
        point,
        event.camera.position,
      );
      normal = [n.x, n.y, n.z];
    }
    addAnnotation(
      [point.x, point.y, point.z],
      normal,
      effectiveModelUrl ?? undefined,
    );
  }
}
