// src/utils/spark_Splat/splatCenters.worker.ts

const ctx = self as unknown as Worker;

function applyMatrix4ToFlatPointsWorker(points: Float32Array, m: number[]) {
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];

    const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
    points[i]     = (m[0] * x + m[4] * y + m[8] * z + m[12]) * w;
    points[i + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * w;
    points[i + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w;
  }
}

ctx.onmessage = (e: MessageEvent<{ centers: Float32Array; matrixElements: number[] }>) => {
  const { centers, matrixElements } = e.data;

  // Perform the heavy loops entirely off the main thread
  applyMatrix4ToFlatPointsWorker(centers, matrixElements);

  // Transfer the buffer back instantly (0-copy overhead)
  ctx.postMessage(centers, [centers.buffer]);
};