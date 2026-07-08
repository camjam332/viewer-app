import { useFrame } from "@react-three/fiber";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  MathUtils,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { ellipsoidPotentialFlowVelocity } from "../../utils/aerodynamics_utils";
import type { MeshBVH } from "three-mesh-bvh";

const SPEED_COLOR_SLOW = new Color("#2b6cff");
const SPEED_COLOR_FAST = new Color("#ff5a3c");

// Single shared material for all trail geometry — vertex colors drive per-sample color/fade.
const TRAIL_MATERIAL = new MeshBasicMaterial({
  vertexColors: true,
  side: DoubleSide,
});

export type FieldContextValue = {
  center: Vector3;
  radii: Vector3;
  maxRadius: number;
  bvh: MeshBVH | null;
  collisionGeometry: BufferGeometry | null;
  flowDirection: Vector3;
  right: Vector3;
  up: Vector3;
};

export const FieldContext = createContext<FieldContextValue | null>(null);

export const StreamlineField = ({
  count,
  freestreamSpeed,
  trailLength,
  colorBySpeed,
  surfaceInfluence,
  repulsionStrength,
}: {
  count: number;
  freestreamSpeed: number;
  trailLength: number;
  colorBySpeed: boolean;
  surfaceInfluence: number;
  repulsionStrength: number;
}) => {
  const field = useContext(FieldContext);

  // Refs to the dynamic buffer attributes so useFrame can write into them
  const posAttr = useRef<BufferAttribute | null>(null);
  const colAttr = useRef<BufferAttribute | null>(null);

  // Single BufferGeometry for all trails combined.
  // Rebuilt only when count or trailLength changes.
  const geo = useMemo(() => {
    const N = count;
    const L = trailLength;
    const g = new BufferGeometry();

    const verts = new Float32Array(N * L * 2 * 3);
    const colors = new Float32Array(N * L * 2 * 3);

    // Index buffer is static — two triangles per segment, never changes shape
    const idx = new Uint32Array(N * (L - 1) * 6);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < L - 1; j++) {
        const vBase = (i * L + j) * 2;
        const iBase = (i * (L - 1) + j) * 6;
        idx[iBase + 0] = vBase + 0;
        idx[iBase + 1] = vBase + 2;
        idx[iBase + 2] = vBase + 1;
        idx[iBase + 3] = vBase + 1;
        idx[iBase + 4] = vBase + 2;
        idx[iBase + 5] = vBase + 3;
      }
    }

    const pA = new BufferAttribute(verts, 3);
    const cA = new BufferAttribute(colors, 3);
    pA.setUsage(DynamicDrawUsage);
    cA.setUsage(DynamicDrawUsage);
    g.setAttribute("position", pA);
    g.setAttribute("color", cA);
    g.setIndex(new BufferAttribute(idx, 1));

    return g;
  }, [count, trailLength]);

  // Sync attribute refs and handle disposal in a Strict Mode safe way.
  // useLayoutEffect runs synchronously before paint, so posAttr/colAttr are
  // always valid by the time the first useFrame fires.
  // The geoRef guard prevents geo.dispose() from being called during React
  // Strict Mode's simulated unmount (where the same geo is still active).
  const geoRef = useRef<BufferGeometry | null>(null);
  useLayoutEffect(() => {
    if (geoRef.current && geoRef.current !== geo) {
      geoRef.current.dispose();
    }
    geoRef.current = geo;
    posAttr.current = geo.attributes.position as BufferAttribute;
    colAttr.current = geo.attributes.color as BufferAttribute;
    return () => {
      posAttr.current = null;
      colAttr.current = null;
    };
  }, [geo]);

  // Per-particle flat arrays — allocated once, swapped on count/field change
  const particlePos = useRef(new Float32Array(0));
  const trailBuf = useRef(new Float32Array(0));
  const trailSpeeds = useRef(new Float32Array(0));
  const trailHead = useRef(new Int32Array(0));
  const trailCnt = useRef(new Int32Array(0));

  useEffect(() => {
    if (!field) return;
    const { center, maxRadius, flowDirection, right, up } = field;
    const spawnRadius = maxRadius * 1.6;
    const N = count;
    const L = trailLength;

    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * spawnRadius;
      const axial = -maxRadius * 2.5 + Math.random() * maxRadius * 5;
      pos[i * 3 + 0] =
        center.x +
        flowDirection.x * axial +
        right.x * Math.cos(angle) * rad +
        up.x * Math.sin(angle) * rad;
      pos[i * 3 + 1] =
        center.y +
        flowDirection.y * axial +
        right.y * Math.cos(angle) * rad +
        up.y * Math.sin(angle) * rad;
      pos[i * 3 + 2] =
        center.z +
        flowDirection.z * axial +
        right.z * Math.cos(angle) * rad +
        up.z * Math.sin(angle) * rad;
    }

    particlePos.current = pos;
    trailBuf.current = new Float32Array(N * L * 3);
    trailSpeeds.current = new Float32Array(N * L);
    trailHead.current = new Int32Array(N);
    trailCnt.current = new Int32Array(N);
  }, [count, trailLength, field]);

  // Scratch vectors — one set, reused for every particle every frame
  const posTmp = useRef(new Vector3());
  const uInf = useRef(new Vector3());
  const farVel = useRef(new Vector3());
  const finalVel = useRef(new Vector3());
  const closestTarget = useRef({
    point: new Vector3(),
    distance: 0,
    faceIndex: -1,
  });
  const normalTmp = useRef(new Vector3());
  const tangentTmp = useRef(new Vector3());
  const dispTmp = useRef(new Vector3());
  const radialTmp = useRef(new Vector3());
  const colorTmp = useRef(new Color());
  const camRight = useRef(new Vector3());

  useFrame((state, delta) => {
    if (!field) return;
    const pA = posAttr.current;
    const cA = colAttr.current;
    const pos = particlePos.current;
    if (!pA || !cA || pos.length < count * 3) return;

    const trail = trailBuf.current;
    const speeds = trailSpeeds.current;
    const head = trailHead.current;
    const cnt = trailCnt.current;
    const verts = pA.array as Float32Array;
    const cols = cA.array as Float32Array;

    const { center, radii, maxRadius, bvh, flowDirection, right, up } = field;
    const spawnRadius = maxRadius * 1.6;
    const N = count;
    const L = trailLength;
    const dt = Math.min(delta, 1 / 30);

    // Camera right vector for camera-facing ribbon width
    camRight.current.setFromMatrixColumn(state.camera.matrixWorld, 0);
    const crx = camRight.current.x;
    const cry = camRight.current.y;
    const crz = camRight.current.z;

    for (let i = 0; i < N; i++) {
      // --- Physics (identical logic to original Streamline) ---
      let px = pos[i * 3 + 0];
      let py = pos[i * 3 + 1];
      let pz = pos[i * 3 + 2];

      posTmp.current.set(px, py, pz);
      uInf.current.copy(flowDirection).multiplyScalar(freestreamSpeed);
      ellipsoidPotentialFlowVelocity(
        posTmp.current,
        center,
        radii,
        uInf.current,
        farVel.current,
      );
      finalVel.current.copy(farVel.current);

      if (
        bvh &&
        posTmp.current.distanceTo(center) < maxRadius + surfaceInfluence * 2
      ) {
        const hit = bvh.closestPointToPoint(
          posTmp.current,
          closestTarget.current,
          0,
          surfaceInfluence,
        );
        if (hit) {
          const dist = hit.distance;
          normalTmp.current.subVectors(posTmp.current, hit.point);
          if (normalTmp.current.lengthSq() > 1e-8)
            normalTmp.current.normalize();
          else normalTmp.current.set(0, 1, 0);

          const vDotN = farVel.current.dot(normalTmp.current);
          tangentTmp.current.copy(farVel.current);
          if (vDotN < 0)
            tangentTmp.current.addScaledVector(normalTmp.current, -vDotN);

          const tInfluence = 1 - MathUtils.clamp(dist / surfaceInfluence, 0, 1);
          const repulsion =
            tInfluence * tInfluence * repulsionStrength * freestreamSpeed;
          finalVel.current
            .copy(tangentTmp.current)
            .addScaledVector(normalTmp.current, repulsion);

          if (dist < 0.01) {
            px = hit.point.x + normalTmp.current.x * 0.012;
            py = hit.point.y + normalTmp.current.y * 0.012;
            pz = hit.point.z + normalTmp.current.z * 0.012;
          }
        }
      }

      px += finalVel.current.x * dt;
      py += finalVel.current.y * dt;
      pz += finalVel.current.z * dt;
      const speed = finalVel.current.length();

      // --- Out-of-bounds respawn ---
      dispTmp.current.set(px - center.x, py - center.y, pz - center.z);
      const axialDist = dispTmp.current.dot(flowDirection);
      radialTmp.current
        .copy(dispTmp.current)
        .addScaledVector(flowDirection, -axialDist);
      if (
        axialDist > maxRadius * 3 ||
        radialTmp.current.length() > spawnRadius * 1.3
      ) {
        const angle = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * spawnRadius;
        const axial = -maxRadius * 2.5;
        px =
          center.x +
          flowDirection.x * axial +
          right.x * Math.cos(angle) * rad +
          up.x * Math.sin(angle) * rad;
        py =
          center.y +
          flowDirection.y * axial +
          right.y * Math.cos(angle) * rad +
          up.y * Math.sin(angle) * rad;
        pz =
          center.z +
          flowDirection.z * axial +
          right.z * Math.cos(angle) * rad +
          up.z * Math.sin(angle) * rad;
        head[i] = 0;
        cnt[i] = 0;
      }

      pos[i * 3 + 0] = px;
      pos[i * 3 + 1] = py;
      pos[i * 3 + 2] = pz;

      // --- Push position into ring buffer ---
      const h = head[i];
      trail[(i * L + h) * 3 + 0] = px;
      trail[(i * L + h) * 3 + 1] = py;
      trail[(i * L + h) * 3 + 2] = pz;
      speeds[i * L + h] = speed;
      head[i] = (h + 1) % L;
      if (cnt[i] < L) cnt[i]++;
      const n = cnt[i];

      // --- Write camera-facing ribbon into geometry buffer ---
      // j=0 is the oldest sample (tail), j=n-1 is the newest (head).
      // si maps j to the correct ring-buffer slot.
      for (let j = 0; j < L; j++) {
        const vBase = (i * L + j) * 2;

        if (j >= n) {
          // Collapse both vertices to the particle head so the triangle
          // connecting this segment to the last valid one is degenerate
          // (collinear/zero-area) and rasterizes no pixels.
          verts[vBase * 3 + 0] = px;
          verts[vBase * 3 + 1] = py;
          verts[vBase * 3 + 2] = pz;
          verts[(vBase + 1) * 3 + 0] = px;
          verts[(vBase + 1) * 3 + 1] = py;
          verts[(vBase + 1) * 3 + 2] = pz;
          continue;
        }

        const si = (h + 1 - n + j + L) % L;
        const sx = trail[(i * L + si) * 3 + 0];
        const sy = trail[(i * L + si) * 3 + 1];
        const sz = trail[(i * L + si) * 3 + 2];
        const spd = speeds[i * L + si];

        // t=0 at tail, t=1 at head; quadratic attenuation matches original Trail
        const tSeg = n > 1 ? j / (n - 1) : 1.0;
        const atten = tSeg * tSeg;
        const halfW = 0.05 * atten;

        verts[(vBase + 0) * 3 + 0] = sx + crx * halfW;
        verts[(vBase + 0) * 3 + 1] = sy + cry * halfW;
        verts[(vBase + 0) * 3 + 2] = sz + crz * halfW;
        verts[(vBase + 1) * 3 + 0] = sx - crx * halfW;
        verts[(vBase + 1) * 3 + 1] = sy - cry * halfW;
        verts[(vBase + 1) * 3 + 2] = sz - crz * halfW;

        let cr: number, cg: number, cb: number;
        if (colorBySpeed) {
          const speedT = MathUtils.clamp(spd / (freestreamSpeed * 1.8), 0, 1);
          colorTmp.current.lerpColors(
            SPEED_COLOR_SLOW,
            SPEED_COLOR_FAST,
            speedT,
          );
          cr = colorTmp.current.r * atten;
          cg = colorTmp.current.g * atten;
          cb = colorTmp.current.b * atten;
        } else {
          cr = SPEED_COLOR_SLOW.r * atten;
          cg = SPEED_COLOR_SLOW.g * atten;
          cb = SPEED_COLOR_SLOW.b * atten;
        }

        cols[(vBase + 0) * 3 + 0] = cr;
        cols[(vBase + 0) * 3 + 1] = cg;
        cols[(vBase + 0) * 3 + 2] = cb;
        cols[(vBase + 1) * 3 + 0] = cr;
        cols[(vBase + 1) * 3 + 1] = cg;
        cols[(vBase + 1) * 3 + 2] = cb;
      }
    }

    pA.needsUpdate = true;
    cA.needsUpdate = true;
  });

  return (
    <mesh geometry={geo} material={TRAIL_MATERIAL} frustumCulled={false} />
  );
};
