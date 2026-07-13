import type { SplatMesh } from "@sparkjsdev/spark";
import { MathUtils, Quaternion, Vector3 } from "three";
import type { CameraControls } from "@react-three/drei";
import type { RefObject } from "react";
import type { ModelOption } from "../../ui/ModelPicker";

// Same plain-function pattern as mkkellogSplat_utils.ts, for the same
// reason - useCallback can't be called at module scope, so the actual
// useCallback wrapping (and its dependency array) stays in App.tsx.

export type HandleSparkSplatLoadDeps = {
  cameraControlsRef: RefObject<CameraControls | null>;
  selectedModel: ModelOption | undefined;
  setMarkerScale: (scale: number) => void;
  clearPoints: () => void;
  setLoadedSplatMesh: (mesh: SplatMesh | null) => void;
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
}
