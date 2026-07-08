import { MathUtils, Vector3 } from "three";

export type FlowConfig = {
  streamlineCount: number;
  freestreamSpeed: number;
  trailLength: number;
  showFieldBounds: boolean;
  showCollisionMesh: boolean;
  colorBySpeed: boolean;
  surfaceInfluence: number;
  repulsionStrength: number;
  flowYawDeg: number; // rotation around world +Y, 0 = +X, 90 = +Z
  flowPitchDeg: number; // tilt up/down out of the horizontal plane
};

export function directionFromYawPitch(
  yawDeg: number,
  pitchDeg: number,
): Vector3 {
  const yaw = MathUtils.degToRad(yawDeg);
  const pitch = MathUtils.degToRad(pitchDeg);
  const x = Math.cos(pitch) * Math.cos(yaw);
  const y = Math.sin(pitch);
  const z = Math.cos(pitch) * Math.sin(yaw);
  return new Vector3(x, y, z).normalize();
}

export function orthonormalBasis(dir: Vector3): {
  right: Vector3;
  up: Vector3;
} {
  const worldUp =
    Math.abs(dir.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(worldUp, dir).normalize();
  const up = new Vector3().crossVectors(dir, right).normalize();
  return { right, up };
}

export function ellipsoidPotentialFlowVelocity(
  p: Vector3,
  center: Vector3,
  radii: Vector3,
  uInf: Vector3,
  out: Vector3,
): Vector3 {
  const lx = (p.x - center.x) / radii.x;
  const ly = (p.y - center.y) / radii.y;
  const lz = (p.z - center.z) / radii.z;

  const r2 = lx * lx + ly * ly + lz * lz;
  const r = Math.sqrt(r2) || 1e-6;

  const ux = uInf.x;
  const uy = uInf.y;
  const uz = uInf.z;

  const rhatx = lx / r;
  const rhaty = ly / r;
  const rhatz = lz / r;

  const uDotRhat = ux * rhatx + uy * rhaty + uz * rhatz;

  const R = 1.0;
  const rClamped = Math.max(r, R);
  const factor = (R * R * R) / (2 * rClamped * rClamped * rClamped);

  const vx = ux + factor * (3 * uDotRhat * rhatx - ux);
  const vy = uy + factor * (3 * uDotRhat * rhaty - uy);
  const vz = uz + factor * (3 * uDotRhat * rhatz - uz);

  out.set(vx * radii.x, vy * radii.y, vz * radii.z).normalize();
  out.multiplyScalar(uInf.length() * (0.4 + 0.6 * Math.min(r, 3)));
  return out;
}
