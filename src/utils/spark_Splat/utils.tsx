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
 * Float32Array, fully off the main thread - both the per-splat unpack
 * (unpackSplat, run inside the worker) and the matrix transform. See
 * splatCenters.worker.ts for why the unpack itself needed to move, not
 * just the transform: a trace showed the unpack loop contributing a
 * ~670ms synchronous main-thread block right inside the onLoad chain,
 * the actual cause of the "stuck at 100%, nothing renders" gap - the
 * matrix transform alone (what an earlier version of this moved) is
 * cheap arithmetic on an already-extracted array and was never the real
 * cost.
 *
 * The worker is a persistent, lazily-created singleton (module-level,
 * not recreated per call) - spinning up a fresh Worker on every load
 * means re-paying real worker/script instantiation overhead each time,
 * similar in kind to the one-time worker/WASM cold-start cost Spark's
 * own pipeline pays once per session (also found via trace analysis).
 * Requests are matched to responses via requestId (same pattern
 * geodesicWorker.ts already uses) rather than a single onmessage/onerror
 * pair per call, since a persistent worker can have more than one
 * request in flight if a user switches models again before the first
 * one finishes.
 */
export type SplatCenterBuffers = {
  forState: Float32Array;
  forClicks: Float32Array;
};

let sharedCentersWorker: Worker | null = null;
const pendingCenterRequests = new Map<
  number,
  {
    resolve: (centers: SplatCenterBuffers) => void;
    reject: (err: unknown) => void;
  }
>();
let nextCenterRequestId = 0;

function getSplatCentersWorker(): Worker {
  if (sharedCentersWorker) return sharedCentersWorker;

  const worker = new Worker(
    new URL("./splatCenters.worker.ts", import.meta.url),
    { type: "module" },
  );

  worker.onmessage = (
    e: MessageEvent<{
      requestId: number;
      centersForState: Float32Array;
      centersForClicks: Float32Array;
    }>,
  ) => {
    const { requestId, centersForState, centersForClicks } = e.data;
    const pending = pendingCenterRequests.get(requestId);
    if (!pending) return; // already settled/abandoned - safe to ignore
    pendingCenterRequests.delete(requestId);
    pending.resolve({ forState: centersForState, forClicks: centersForClicks });
  };

  worker.onerror = (err) => {
    // A worker-level error isn't scoped to a single request - reject
    // everything currently in flight rather than leave those promises
    // pending forever.
    for (const { reject } of pendingCenterRequests.values()) reject(err);
    pendingCenterRequests.clear();
  };

  sharedCentersWorker = worker;
  return worker;
}

export function extractSparkSplatCentersAsync(
  splatMesh: SplatMesh,
): Promise<SplatCenterBuffers> {
  return new Promise((resolve, reject) => {
    const packedSplats = splatMesh.packedSplats;
    const numSplats = packedSplats?.numSplats ?? 0;
    if (!packedSplats || numSplats === 0) {
      resolve({
        forState: new Float32Array(0),
        forClicks: new Float32Array(0),
      });
      return;
    }

    // A COPY of the packed array, not a transfer of the live one -
    // transferring splatMesh's own packedArray would detach its
    // underlying buffer out from under the actively-rendering splat,
    // which may still need to read it later (Spark's own LOD/re-encoding
    // paths, for instance). The copy is a fast, contiguous memory copy -
    // not the per-splat decode work this whole change exists to move off
    // the main thread, so it doesn't reintroduce a meaningful stall.
    const packedArrayCopy = new Uint32Array(packedSplats.packedArray ?? []);

    splatMesh.updateMatrixWorld(true);
    const matrixElements = Array.from(splatMesh.matrixWorld.elements);

    const requestId = nextCenterRequestId++;
    pendingCenterRequests.set(requestId, { resolve, reject });

    getSplatCentersWorker().postMessage(
      {
        requestId,
        packedArray: packedArrayCopy,
        numSplats,
        splatEncoding: packedSplats.splatEncoding,
        matrixElements,
      },
      [packedArrayCopy.buffer],
    );
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
  // Two independent buffers, not one shared reference - see
  // splatCenters.worker.ts for why. forState feeds Measurement's prop
  // (which safely transfers it away to the geodesic worker, since it's
  // exclusively that effect's to consume); forClicks stays on the main
  // thread indefinitely for repeat click-based normal estimation.
  applySplatCenters: (
    forState: Float32Array | null,
    forClicks: Float32Array | null,
  ) => void;
  // Used only to detect staleness once the async extraction below
  // resolves - by that point (a real async round-trip through a worker
  // now, not just a same-tick deferral), splatRef.current reliably
  // reflects whatever's actually loaded, unlike right at onLoad time
  // itself (see readSplatTransform's comment in App.tsx for why that
  // specific moment isn't reliable).
  splatRef: RefObject<SplatMesh | null>;
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
    applySplatCenters,
    splatRef,
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
    .then(({ forState, forClicks }) => {
      // Guarded against staleness: if the user has already switched to a
      // different model by the time the worker responds, splatRef.current
      // will no longer be this splatMesh - writing splatCenters now would
      // silently apply stale geodesic data to whatever's actually loaded
      // (or overwrite the model-change reset entirely). Skip rather than
      // trust that nothing changed during the round-trip.
      if (splatRef.current !== splatMesh) return;
      applySplatCenters(forState, forClicks);
    })
    .catch((error: unknown) => {
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

// ---------------------------------------------------------------------
// Floater cleanup
// ---------------------------------------------------------------------

export type FloaterAnalysis = {
  scores: Float32Array;
  opacities: Float32Array;
};

// Persistent, lazily-created singleton, same reasoning as the splat
// centers worker: analysis is triggered explicitly by the user (not on
// every load), but a fresh Worker per click would still mean re-paying
// real script/instantiation overhead each time.
let sharedFloaterWorker: Worker | null = null;
const pendingFloaterRequests = new Map<
  number,
  { resolve: (result: FloaterAnalysis) => void; reject: (err: unknown) => void }
>();
let nextFloaterRequestId = 0;

function getFloaterWorker(): Worker {
  if (sharedFloaterWorker) return sharedFloaterWorker;

  const worker = new Worker(
    new URL("./floaterDetection.worker.ts", import.meta.url),
    { type: "module" },
  );

  worker.onmessage = (
    e: MessageEvent<{
      requestId: number;
      scores: Float32Array;
      opacities: Float32Array;
    }>,
  ) => {
    const { requestId, scores, opacities } = e.data;
    const pending = pendingFloaterRequests.get(requestId);
    if (!pending) return; // already settled/abandoned - safe to ignore
    pendingFloaterRequests.delete(requestId);
    pending.resolve({ scores, opacities });
  };

  worker.onerror = (err) => {
    for (const { reject } of pendingFloaterRequests.values()) reject(err);
    pendingFloaterRequests.clear();
  };

  sharedFloaterWorker = worker;
  return worker;
}

export function revertSparkFloaterAnalysis(
  splatMesh: SplatMesh,
  analysis: FloaterAnalysis | null,
): void {
  // 1. Re-enable the Level of Detail (LOD) system
  splatMesh.enableLod = true;

  const packedSplats = splatMesh.packedSplats;
  if (!packedSplats || !analysis) return;

  const { opacities } = analysis;

  // 2. Restore every splat back to its original opacity
  for (let i = 0; i < opacities.length; i++) {
    const current = packedSplats.getSplat(i);
    const originalOpacity = opacities[i];

    if (current.opacity === originalOpacity) continue; // Already at original state, skip

    packedSplats.setSplat(
      i,
      current.center,
      current.scales,
      current.quaternion,
      originalOpacity,
      current.color,
    );
  }

  // 3. Inform the generator to rebuild the GPU buffers
  packedSplats.needsUpdate = true;
  splatMesh.updateGenerator();
}

/**
 * Runs the one-time, expensive k-NN density analysis for a loaded splat.
 * Reuses the already-extracted world-space centers (from
 * extractSparkSplatCentersAsync, already sitting in App.tsx state for
 * the geodesic feature) rather than re-decoding them - only opacity
 * needs a fresh decode pass here.
 */
export function analyzeSparkSplatFloaters(
  splatMesh: SplatMesh,
  centers: Float32Array,
  k = 8,
): Promise<FloaterAnalysis> {
  // When LOD is active, Spark's actual GPU render path swaps to
  // packedSplats.lodSplats - a separate PackedSplats instance built by
  // the "Tiny LoD" algorithm, with a different splat count entirely
  // (confirmed: 270,491 became 325,942 for one real capture during
  // earlier performance work). There's no clean index mapping from the
  // base array to that restructured one, so editing packedSplats (what
  // applySparkFloaterThreshold does) has genuinely zero visual effect
  // while LOD rendering is active - confirmed directly from
  // SplatMesh.ts's per-frame update path. Disabling LOD here is a real,
  // known tradeoff (the antialias/LOD work earlier this session measured
  // a 46->64fps improvement from having it on) - accepted specifically
  // at the moment floater cleanup is opted into, not silently for every
  // splat regardless of whether this feature is ever used.
  splatMesh.enableLod = false;

  return new Promise((resolve, reject) => {
    const packedSplats = splatMesh.packedSplats;
    const numSplats = packedSplats?.numSplats ?? 0;
    if (!packedSplats || numSplats === 0 || centers.length === 0) {
      resolve({ scores: new Float32Array(0), opacities: new Float32Array(0) });
      return;
    }

    // Copies, not transfers - centers is still needed elsewhere (the
    // click-based normal estimation ref, and this same array is reused
    // rather than owned exclusively by this call), and packedArray is
    // the live splat's own data, which must not be detached out from
    // under the actively-rendering mesh.
    const centersCopy = new Float32Array(centers);
    const packedArrayCopy = new Uint32Array(packedSplats.packedArray ?? []);

    const requestId = nextFloaterRequestId++;
    pendingFloaterRequests.set(requestId, { resolve, reject });

    getFloaterWorker().postMessage(
      {
        requestId,
        centers: centersCopy,
        packedArray: packedArrayCopy,
        numSplats,
        splatEncoding: packedSplats.splatEncoding,
        k,
      },
      [centersCopy.buffer, packedArrayCopy.buffer],
    );
  });
}

/**
 * Applies a threshold to already-computed floater scores - the cheap,
 * instant half of the feature, meant to run on every slider tick.
 * Splats scoring above the threshold get opacity 0 (hidden); everything
 * else is restored to its real, original opacity. Iterates every splat
 * unconditionally rather than tracking a delta from the previous
 * threshold - simpler to reason about, and fine for a debounced,
 * user-driven slider rather than something firing every frame. Returns
 * the hidden count for UI feedback ("1,204 splats hidden").
 *
 * Rewrites the full splat entry via setSplat (opacity can't be set in
 * isolation), but only ever touches opacity - center/scale/rotation/
 * color are read back from getSplat() itself, never cached separately,
 * since nothing else in this feature ever modifies them.
 */
export function applySparkFloaterThreshold(
  splatMesh: SplatMesh,
  analysis: FloaterAnalysis,
  threshold: number,
): number {
  const packedSplats = splatMesh.packedSplats;
  if (!packedSplats) return 0;

  const { scores, opacities } = analysis;
  let hiddenCount = 0;

  for (let i = 0; i < scores.length; i++) {
    const shouldHide = scores[i] > threshold;
    if (shouldHide) hiddenCount++;

    const current = packedSplats.getSplat(i);
    const targetOpacity = shouldHide ? 0 : opacities[i];
    if (current.opacity === targetOpacity) continue; // no-op, skip the write

    packedSplats.setSplat(
      i,
      current.center,
      current.scales,
      current.quaternion,
      targetOpacity,
      current.color,
    );
  }
  packedSplats.needsUpdate = true;
  splatMesh.updateGenerator();
  return hiddenCount;
}
