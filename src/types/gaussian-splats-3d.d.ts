// @mkkellogg/gaussian-splats-3d ships no official types. This covers only
// the surface actually used across SplatViewer.tsx and the sanity check -
// extend as needed. (A community-typed fork, guyettinger/gle-gaussian-splat-3d,
// also exists if full API coverage becomes worth the dependency swap.)
declare module "@mkkellogg/gaussian-splats-3d" {
  import { Group, Camera, Scene, WebGLRenderer } from "three";

  export interface DropInViewerOptions {
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    camera?: Camera;
    renderer?: WebGLRenderer;
    threeScene?: Scene;
    // Self-driven-mode-only options (used when the library owns its own
    // camera/controls, e.g. the sanity check - harmless to leave optional
    // here even though managed mode never sets them)
    cameraUp?: [number, number, number];
    initialCameraPosition?: [number, number, number];
    initialCameraLookAt?: [number, number, number];
    sharedMemoryForWorkers?: boolean;
    gpuAcceleratedSort?: boolean;
    showLoadingUI?: boolean;
    integerBasedSort?: boolean;
    splatSortDistanceMapPrecision?: number;
    sphericalHarmonicsDegree?: 0 | 1 | 2;
    [key: string]: unknown;
  }

  export interface SplatSceneParams {
    /** Only used by DropInViewer.addSplatScenes' array form */
    path?: string;
    splatAlphaRemovalThreshold?: number;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    showLoadingUI?: boolean;
    progressiveLoad?: boolean;
    [key: string]: unknown;
  }

  export class DropInViewer extends Group {
    constructor(options?: DropInViewerOptions);
    addSplatScene(path: string, options?: SplatSceneParams): Promise<void>;
    addSplatScenes(
      scenes: SplatSceneParams[],
      showLoadingUI?: boolean,
    ): Promise<void>;
    dispose(): Promise<void>;
  }

  export class Viewer {
    constructor(options?: DropInViewerOptions);
    addSplatScene(path: string, options?: SplatSceneParams): Promise<void>;
    start(): void;
    stop(): void;
    update(): void;
    render(): void;
    dispose(): Promise<void>;
  }
}