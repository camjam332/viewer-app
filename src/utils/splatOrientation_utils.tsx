import { Vector3, Quaternion } from "three";

/**
 * Finds the dominant eigenvector of a 3x3 symmetric matrix via power
 * iteration - only the single largest-eigenvalue direction is needed
 * here, not a full eigendecomposition. Also returns the Rayleigh quotient
 * (v^T M v after convergence) as the corresponding eigenvalue - used as a
 * rough confidence signal: how much more dominant this direction is than
 * the alternatives, rather than trusting a numerically-arbitrary result
 * when the input is closer to isotropic (no real dominant direction).
 */
function dominantEigenvector(
  m00: number,
  m01: number,
  m02: number,
  m11: number,
  m12: number,
  m22: number,
  seed: Vector3,
): { direction: Vector3; eigenvalue: number } {
  let v = seed.clone().normalize();
  for (let iter = 0; iter < 30; iter++) {
    const vx = m00 * v.x + m01 * v.y + m02 * v.z;
    const vy = m01 * v.x + m11 * v.y + m12 * v.z;
    const vz = m02 * v.x + m12 * v.y + m22 * v.z;
    const next = new Vector3(vx, vy, vz);
    if (next.lengthSq() < 1e-20) break; // degenerate - bail with current v
    v = next.normalize();
  }
  const mvx = m00 * v.x + m01 * v.y + m02 * v.z;
  const mvy = m01 * v.x + m11 * v.y + m12 * v.z;
  const mvz = m02 * v.x + m12 * v.y + m22 * v.z;
  const eigenvalue = v.x * mvx + v.y * mvy + v.z * mvz;
  return { direction: v, eigenvalue };
}

/**
 * Per-splat samples needed to detect orientation - deliberately just
 * plain, flat, world-space arrays rather than a library-specific
 * SplatMesh type. Same reasoning as Measurement.tsx's splatCenters prop
 * and buildSplatGraph: the actual detection math doesn't know or care
 * which splat library produced the data, only that it's world-space
 * centers and normals. Each library gets its own small "sample this
 * SplatMesh and produce these arrays" function instead (see
 * sampleSparkSplatOrientation in sparkSplat_utils.ts).
 *
 * centers and normals must be parallel (same length, same sample order).
 * A (0,0,0) normal entry means "skip this sample" - mirrors the original
 * per-splat degenerate-normal handling.
 */
export type SplatOrientationSamples = {
  centers: Float32Array;
  normals: Float32Array;
};

/**
 * Estimates a full orientation correction for a splat scene - up-axis
 * AND yaw - from the splat data itself, with no external reference.
 *
 * UP AXIS: a Gaussian fit to a flat surface (floor, ceiling, wall) tends
 * to be squashed along its local surface normal - the smallest of its 3
 * scale axes, rotated into world space by the splat's own rotation, is a
 * per-splat estimate of local surface normal (this is what each library's
 * sampling function computes before calling in here). Floor and ceiling
 * normals dominate a typical room scan and both point along the same
 * vertical axis (opposite signs), so the axis those normals cluster
 * around most strongly is a good "up" candidate.
 *
 * YAW: reusing the same sampled normals, rotated into the now-corrected
 * up frame and filtered down to the near-horizontal ("wall-like") ones,
 * the same dominant-direction analysis - confined to the horizontal
 * plane this time - finds the dominant wall-normal direction and aligns
 * it to a reference axis (+Z).
 *
 * Both are genuine heuristics, not guarantees. They work well for scenes
 * with clear dominant planar surfaces (rooms, interiors) and aren't
 * meaningful for scenes without them (an object scan like a shoe has no
 * floor or walls). Up-axis SIGN is resolved with a cruder density-based
 * heuristic and is the part most likely to need a manual 180° correction.
 * Yaw is skipped entirely (falling back to up-correction only) when
 * there isn't a confidently dominant wall direction to align to - e.g. a
 * circular room, or too few wall-like samples.
 */
export function detectOrientationFromSamples(
  samples: SplatOrientationSamples,
): Quaternion {
  const { centers, normals } = samples;
  const sampled = Math.min(centers.length, normals.length) / 3;
  if (sampled === 0) return new Quaternion();

  let m00 = 0,
    m01 = 0,
    m02 = 0,
    m11 = 0,
    m12 = 0,
    m22 = 0;

  for (let i = 0; i < sampled; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    if (nx === 0 && ny === 0 && nz === 0) continue; // degenerate, skip
    m00 += nx * nx;
    m01 += nx * ny;
    m02 += nx * nz;
    m11 += ny * ny;
    m12 += ny * nz;
    m22 += nz * nz;
  }

  // --- Up axis ---
  const { direction: upRaw } = dominantEigenvector(
    m00,
    m01,
    m02,
    m11,
    m12,
    m22,
    new Vector3(1, 1, 1),
  );
  const up = upRaw.clone();

  // Sign disambiguation: project sampled centers onto the candidate axis
  // and compare point density near each extreme. A floor is a thin
  // surface with little to nothing captured beneath it, while the
  // opposite extreme (toward a ceiling) more often has some content
  // beyond it. Whichever end is sparser is treated as "down".
  let min = Infinity;
  let max = -Infinity;
  const projections = new Array(sampled);
  for (let i = 0; i < sampled; i++) {
    const p =
      centers[i * 3] * up.x +
      centers[i * 3 + 1] * up.y +
      centers[i * 3 + 2] * up.z;
    projections[i] = p;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const range = max - min;
  if (range > 1e-9) {
    const band = range * 0.1;
    let bottomCount = 0;
    let topCount = 0;
    for (const p of projections) {
      if (p < min + band) bottomCount++;
      if (p > max - band) topCount++;
    }
    if (bottomCount > topCount) up.multiplyScalar(-1);
  }

  const upRotation = new Quaternion().setFromUnitVectors(
    up,
    new Vector3(0, 1, 0),
  );

  // --- Yaw: dominant wall-normal direction, confined to the horizontal
  // plane of the now up-corrected frame ---
  const HORIZONTAL_THRESHOLD = 0.3; // |normal.y| below this counts as "wall-like"
  const MIN_WALL_SAMPLES = 30;
  const MIN_CONFIDENCE = 0.55; // top eigenvalue / trace - ~0.5 means no clear winner

  let wm00 = 0,
    wm02 = 0,
    wm22 = 0; // m01/m12 stay zero by construction (all inputs have y=0)
  let wallSamples = 0;
  const scratch = new Vector3();

  for (let i = 0; i < sampled; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    if (nx === 0 && ny === 0 && nz === 0) continue; // degenerate, skip

    scratch.set(nx, ny, nz).applyQuaternion(upRotation);
    if (Math.abs(scratch.y) > HORIZONTAL_THRESHOLD) continue; // not wall-like

    scratch.y = 0;
    if (scratch.lengthSq() < 1e-12) continue;
    scratch.normalize();

    wm00 += scratch.x * scratch.x;
    wm02 += scratch.x * scratch.z;
    wm22 += scratch.z * scratch.z;
    wallSamples++;
  }

  if (wallSamples < MIN_WALL_SAMPLES) {
    return upRotation; // not enough wall-like signal to trust a yaw estimate
  }

  const { direction: wallAxisXZ, eigenvalue } = dominantEigenvector(
    wm00,
    0,
    wm02,
    0,
    0,
    wm22,
    new Vector3(1, 0, 1),
  );

  const trace = wm00 + wm22; // sum of the two XZ eigenvalues
  const confidence = trace > 1e-9 ? eigenvalue / trace : 0;
  if (confidence < MIN_CONFIDENCE) {
    // No clearly dominant wall direction (e.g. a circular room, or an
    // open/atrium-like space) - a yaw pick here would be closer to noise
    // than signal, so leave yaw alone.
    return upRotation;
  }

  const yawRotation = new Quaternion().setFromUnitVectors(
    wallAxisXZ,
    new Vector3(1, 0, 0),
  );

  return yawRotation.multiply(upRotation);
}
