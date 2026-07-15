// src/utils/spark_Splat/splatCenters.worker.ts
//
// Does the FULL center extraction here - both the per-splat unpack (the
// actual expensive part, confirmed via trace analysis: ~670ms of
// synchronous main-thread time when this ran inline in
// handleSparkSplatLoad) and the matrix transform (cheap on its own, but
// no reason to bounce back to the main thread for it when the data's
// already here).
//
// Imports unpackSplat directly from @sparkjsdev/spark rather than
// reimplementing Spark's packed-splat bit layout ourselves - confirmed
// it's a real, public export (src/index.ts) and confirmed it's pure
// JavaScript with no WASM dependency, so there's no redundant WASM
// compile cost from using it here. Reimplementing the packing format by
// hand was considered and rejected: it would be faster to skip fields we
// don't need (scale/rotation/color/opacity), but fragile against any
// future change to Spark's own packing format, for a marginal gain next
// to the real cost (raw decode volume across hundreds of thousands of
// splats).
import { unpackSplat } from "@sparkjsdev/spark";

const ctx = self as unknown as Worker;

type SplatEncoding = {
  rgbMin?: number;
  rgbMax?: number;
  lnScaleMin?: number;
  lnScaleMax?: number;
  lodOpacity?: boolean;
};

type ExtractRequest = {
  requestId: number;
  packedArray: Uint32Array;
  numSplats: number;
  splatEncoding?: SplatEncoding;
  matrixElements: number[];
};

type ExtractResponse = {
  requestId: number;
  centersForState: Float32Array;
  centersForClicks: Float32Array;
};

function applyMatrix4ToFlatPointsWorker(points: Float32Array, m: number[]) {
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];

    const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
    points[i] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * w;
    points[i + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * w;
    points[i + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w;
  }
}

ctx.onmessage = (e: MessageEvent<ExtractRequest>) => {
  const { requestId, packedArray, numSplats, splatEncoding, matrixElements } =
    e.data;

  const centers = new Float32Array(numSplats * 3);

  // unpackSplat reuses one static object per Spark's own implementation
  // (confirmed from source) - no per-splat allocation here, just the
  // decode arithmetic itself, which is the real cost this worker exists
  // to move off the main thread.
  for (let i = 0; i < numSplats; i++) {
    const unpacked = unpackSplat(packedArray, i, splatEncoding);
    centers[i * 3] = unpacked.center.x;
    centers[i * 3 + 1] = unpacked.center.y;
    centers[i * 3 + 2] = unpacked.center.z;
  }

  applyMatrix4ToFlatPointsWorker(centers, matrixElements);

  // Two independent buffers, not one array shared between two consumers.
  // App.tsx hands one to React state (feeds Measurement.tsx, which
  // safely transfers it away to the geodesic worker - it only ever reads
  // it once) and keeps the other in a ref indefinitely for repeat
  // click-based normal estimation. Duplicating here is a cheap
  // contiguous memory copy, nowhere near the cost of the decode loop
  // above - doing it here rather than on the main thread is what keeps
  // Measurement's later transfer genuinely free instead of just moving
  // today's stall to tomorrow's.
  const centersForState = centers;
  const centersForClicks = new Float32Array(centers);

  const response: ExtractResponse = {
    requestId,
    centersForState,
    centersForClicks,
  };
  ctx.postMessage(response, [
    centersForState.buffer,
    centersForClicks.buffer,
  ]);
};