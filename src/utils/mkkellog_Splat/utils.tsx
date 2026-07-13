import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import { MathUtils, Quaternion, Vector3, type Group } from "three";
import type { CameraControls } from "@react-three/drei";
import type { RefObject } from "react";
import type { ModelOption } from "../../ui/ModelPicker";
import type { Tool } from "../../state/state";
import type { SplatHit } from "../../components/mkkellog_Splat/SplatViewer";

// Plain functions rather than hooks, deliberately - useCallback can only be
// called inside a component or another hook, so it can't live at module
// scope in a plain utils file. These take everything they need as explicit
// parameters instead; the actual useCallback wrapping (and the dependency
// arrays that go with it) stays in App.tsx, where hooks are legal and where
// the existing StrictMode/stable-callback lessons this whole splat feature
// has already been built around still apply.

export type HandleSplatLoadDeps = {
  cameraControlsRef: RefObject<CameraControls | null>;
  selectedModel: ModelOption | undefined;
  setMarkerScale: (scale: number) => void;
  clearPoints: () => void;
  setLoadedSplatMesh: (mesh: GaussianSplats3D.SplatMesh | null) => void;
};

export function handleSplatLoad(
  viewer: GaussianSplats3D.DropInViewer,
  deps: HandleSplatLoadDeps,
): void {
  const {
    cameraControlsRef,
    selectedModel,
    setMarkerScale,
    clearPoints,
    setLoadedSplatMesh,
  } = deps;

  const splatMesh = viewer.splatMesh;
  if (!splatMesh || !cameraControlsRef.current) return;
  if (splatMesh.getSplatCount() === 0) return;

  const viewMode = selectedModel?.splatViewMode ?? "object";

  if (viewMode === "interior") {
    viewer.quaternion.premultiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        MathUtils.degToRad(180),
      ),
    );
    // Updates the whole subtree, including splatMesh's matrixWorld - the
    // correction above needs to be reflected there before bounds are
    // computed off of it.
    viewer.updateMatrixWorld(true);
  }

  const box = splatMesh
    .computeBoundingBox(true)
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

export type SplatClickDeps = {
  tool: Tool;
  splatRef: RefObject<Group | null>;
  addPoint: (point: Vector3) => void;
  addAnnotation: (
    position: [number, number, number],
    normal: [number, number, number],
    modelUrl?: string,
  ) => void;
  effectiveModelUrl: string | null;
};

export function splatClick(hit: SplatHit, deps: SplatClickDeps): void {
  const { tool, splatRef, addPoint, addAnnotation, effectiveModelUrl } = deps;

  if (!hit) return;
  if (tool === "measure") {
    const point = new Vector3(...hit.point);
    addPoint(point);
  }
  if (tool === "annotate" && splatRef.current) {
    let normal: [number, number, number] = [0, 0, 1];
    if (hit.normal) {
      const normalVals = hit.normal
        .clone()
        .transformDirection(splatRef.current.matrixWorld);
      normal = [normalVals.x, normalVals.y, normalVals.z];
    }
    const position: [number, number, number] = hit.point;
    addAnnotation(position, normal, effectiveModelUrl ?? undefined);
  }
}
