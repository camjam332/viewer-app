// @mkkellogg/gaussian-splats-3d ships no official types. This covers only
// the surface actually used across SplatViewer.tsx and Measurement.tsx -
// extend as needed. (A community-typed fork, guyettinger/gle-gaussian-splat-3d,
// also exists if full API coverage becomes worth the dependency swap.)
declare module "@mkkellogg/gaussian-splats-3d" {
  import { Group, Mesh, Camera, Box3, Vector3, Quaternion } from "three";

  export interface DropInViewerOptions {
    sharedMemoryForWorkers?: boolean;
    gpuAcceleratedSort?: boolean;
    showLoadingUI?: boolean;
    integerBasedSort?: boolean;
    splatSortDistanceMapPrecision?: number;
    sphericalHarmonicsDegree?: 0 | 1 | 2;
    [key: string]: unknown;
  }

  export interface SplatSceneParams {
    path?: string;
    splatAlphaRemovalThreshold?: number;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    showLoadingUI?: boolean;
    progressiveLoad?: boolean;
    [key: string]: unknown;
  }

  export interface SplatHit {
    origin: Vector3;
    normal: Vector3;
    distance: number;
    splatIndex: number;
  }

  // Real public method - iterates actual splat center positions, unlike
  // any bounds you'd get from Box3().setFromObject() (which only sees the
  // placeholder template geometry, not the real per-splat data in textures).
  // applySceneTransforms accounts for any position/rotation/scale passed to
  // addSplatScene(); it does NOT include the SplatMesh's own matrixWorld -
  // apply that separately for a true world-space box.
  export class SplatMesh extends Mesh {
    getSplatCount(): number;
    computeBoundingBox(applySceneTransforms?: boolean, sceneIndex?: number): Box3;
    // Only the params actually used are typed - real signature has several
    // more optional trailing params (compression levels, src/dest ranges,
    // sceneIndex) that aren't needed here. Pass null for any array you
    // don't want populated.
    fillSplatDataArrays(
      covariances: Float32Array | null,
      scales: Float32Array | null,
      rotations: Float32Array | null,
      centers: Float32Array | null,
      colors: Uint8Array | null,
      sphericalHarmonics: Float32Array | null,
      applySceneTransform?: boolean,
    ): void;
    // Both mutate the passed-in output object in place and return void -
    // same "output parameter" convention as fillSplatDataArrays, just for
    // a single splat by global index instead of the whole mesh at once.
    getSplatCenter(
      globalIndex: number,
      outCenter: Vector3,
      applySceneTransform?: boolean,
    ): void;
    getSplatScaleAndRotation(
      globalIndex: number,
      outScale: Vector3,
      outRotation: Quaternion,
      applySceneTransform?: boolean,
    ): void;
  }

  // Not part of the library's public API - an internal instance property,
  // documented here only because SplatViewer.tsx reaches into it directly.
  interface InternalRaycaster {
    setFromCameraAndScreenPosition(
      camera: Camera,
      screenPosition: { x: number; y: number },
      screenDimensions: { x: number; y: number },
    ): void;
    intersectSplatMesh(splatMesh: SplatMesh, outHits?: SplatHit[]): SplatHit[];
  }

  export class DropInViewer extends Group {
    constructor(options?: DropInViewerOptions);
    addSplatScene(path: string, options?: SplatSceneParams): Promise<void>;
    addSplatScenes(scenes: SplatSceneParams[], showLoadingUI?: boolean): Promise<void>;
    dispose(): Promise<void>;
    splatMesh: SplatMesh | null;
    viewer: { raycaster: InternalRaycaster };
  }
}