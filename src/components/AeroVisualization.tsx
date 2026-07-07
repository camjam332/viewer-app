/**
 * AeroVisualizationBVH.tsx
 * -----------------------------------------------------------------------
 * Upgraded version of AeroVisualization.tsx that deflects streamlines off
 * the ACTUAL loaded mesh surface instead of just an approximated bounding
 * ellipsoid, using three-mesh-bvh for fast nearest-surface-point queries.
 *
 * NEW: flow direction is now controllable (yaw/pitch), not hardcoded +X.
 * Everything that used to assume "+X is downstream" — the far-field
 * vector, particle spawn plane, and out-of-bounds recycling — is now
 * expressed relative to a `flowDirection` unit vector plus an
 * orthonormal `right`/`up` basis perpendicular to it.
 *
 * STRATEGY (two-field blend):
 *   FAR FIELD  -> closed-form ellipsoid potential-flow solution, now
 *                 driven by an arbitrary freestream direction instead of
 *                 a fixed axis.
 *   NEAR FIELD -> once a particle gets within an influence radius of the
 *                 real mesh surface (via BVH.closestPointToPoint), we
 *                 project the far-field velocity onto the surface
 *                 tangent plane and add a normal-direction repulsion
 *                 term that fades out at the influence radius.
 *
 * Dependencies:
 *   npm i three @react-three/fiber @react-three/drei three-mesh-bvh
 * -----------------------------------------------------------------------
 */

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Grid,
  Html,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  MeshBVH,
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import {
  directionFromYawPitch,
  ellipsoidPotentialFlowVelocity,
  orthonormalBasis,
} from "../utils/aerodynamics_utils";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface FlowConfig {
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
}

const DEFAULT_CONFIG: FlowConfig = {
  streamlineCount: 260,
  freestreamSpeed: 1.6,
  trailLength: 60,
  showFieldBounds: false,
  showCollisionMesh: false,
  colorBySpeed: true,
  surfaceInfluence: 0.22,
  repulsionStrength: 1.4,
  flowYawDeg: 0,
  flowPitchDeg: 0,
};

const FLOW_PRESETS: { label: string; yaw: number; pitch: number }[] = [
  { label: "Front (+X)", yaw: 0, pitch: 0 },
  { label: "Rear (-X)", yaw: 180, pitch: 0 },
  { label: "Side (+Z)", yaw: 90, pitch: 0 },
  { label: "Side (-Z)", yaw: -90, pitch: 0 },
  { label: "Top-down", yaw: 0, pitch: -80 },
  { label: "3/4 front", yaw: 35, pitch: -10 },
];

// ---------------------------------------------------------------------------
// Direction helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Far-field: closed-form potential flow around an ellipsoid approximation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared context: model bounds, collision BVH, and current flow direction
// ---------------------------------------------------------------------------

interface FieldContextValue {
  center: THREE.Vector3;
  radii: THREE.Vector3;
  maxRadius: number;
  bvh: MeshBVH | null;
  collisionGeometry: THREE.BufferGeometry | null;
  flowDirection: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

const FieldContext = createContext<FieldContextValue | null>(null);

// ---------------------------------------------------------------------------
// Model loader
// ---------------------------------------------------------------------------

interface ModelFieldInfo {
  center: THREE.Vector3;
  radii: THREE.Vector3;
  maxRadius: number;
  bvh: MeshBVH | null;
  collisionGeometry: THREE.BufferGeometry | null;
}

function Model({
  url,
  onField,
}: {
  url: string;
  onField: (f: ModelFieldInfo) => void;
}) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Reset to identity before measuring so Box3.setFromObject gives
    // local-space bounds, not bounds warped by the previous model's
    // stale scale/position still sitting on this group.
    group.scale.set(1, 1, 1);
    group.position.set(0, 0, 0);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2 / maxDim;

    group.scale.setScalar(scale);
    group.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    group.updateMatrixWorld(true);

    const strippedGeometries: THREE.BufferGeometry[] = [];
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as any).isMesh) return;

      const geom = mesh.geometry.clone();
      geom.applyMatrix4(mesh.matrixWorld);
      if (!geom.attributes.normal) geom.computeVertexNormals();

      const stripped = new THREE.BufferGeometry();
      stripped.setAttribute("position", geom.attributes.position);
      stripped.setAttribute("normal", geom.attributes.normal);
      if (geom.index) stripped.setIndex(geom.index);
      strippedGeometries.push(stripped);
    });

    let bvh: MeshBVH | null = null;
    let merged: THREE.BufferGeometry | null = null;

    if (strippedGeometries.length > 0) {
      merged = mergeGeometries(strippedGeometries, false);
      if (merged) {
        bvh = new MeshBVH(merged);
      }
    }

    const paddedRadii = new THREE.Vector3(
      (size.x * scale) / 2 + 0.15,
      (size.y * scale) / 2 + 0.15,
      (size.z * scale) / 2 + 0.15,
    );

    onField({
      center: new THREE.Vector3(0, 0, 0),
      radii: paddedRadii,
      maxRadius: Math.max(paddedRadii.x, paddedRadii.y, paddedRadii.z),
      bvh,
      collisionGeometry: merged,
    });
  }, [cloned, onField]);

  return (
    <group ref={groupRef}>
      <primitive object={cloned} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Streamline particle
// ---------------------------------------------------------------------------

const SPEED_COLOR_SLOW = new THREE.Color("#2b6cff");
const SPEED_COLOR_FAST = new THREE.Color("#ff5a3c");

// Single shared material for all trail geometry — vertex colors drive per-sample color/fade.
const TRAIL_MATERIAL = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
});

function StreamlineField({
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
}) {
  const field = useContext(FieldContext);

  // Refs to the dynamic buffer attributes so useFrame can write into them
  const posAttr = useRef<THREE.BufferAttribute | null>(null);
  const colAttr = useRef<THREE.BufferAttribute | null>(null);

  // Single BufferGeometry for all trails combined.
  // Rebuilt only when count or trailLength changes.
  const geo = useMemo(() => {
    const N = count;
    const L = trailLength;
    const g = new THREE.BufferGeometry();

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

    const pA = new THREE.BufferAttribute(verts, 3);
    const cA = new THREE.BufferAttribute(colors, 3);
    pA.setUsage(THREE.DynamicDrawUsage);
    cA.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pA);
    g.setAttribute("color", cA);
    g.setIndex(new THREE.BufferAttribute(idx, 1));

    return g;
  }, [count, trailLength]);

  // Sync attribute refs and handle disposal in a Strict Mode safe way.
  // useLayoutEffect runs synchronously before paint, so posAttr/colAttr are
  // always valid by the time the first useFrame fires.
  // The geoRef guard prevents geo.dispose() from being called during React
  // Strict Mode's simulated unmount (where the same geo is still active).
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  useLayoutEffect(() => {
    if (geoRef.current && geoRef.current !== geo) {
      geoRef.current.dispose();
    }
    geoRef.current = geo;
    posAttr.current = geo.attributes.position as THREE.BufferAttribute;
    colAttr.current = geo.attributes.color as THREE.BufferAttribute;
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
  const posTmp = useRef(new THREE.Vector3());
  const uInf = useRef(new THREE.Vector3());
  const farVel = useRef(new THREE.Vector3());
  const finalVel = useRef(new THREE.Vector3());
  const closestTarget = useRef({
    point: new THREE.Vector3(),
    distance: 0,
    faceIndex: -1,
  });
  const normalTmp = useRef(new THREE.Vector3());
  const tangentTmp = useRef(new THREE.Vector3());
  const dispTmp = useRef(new THREE.Vector3());
  const radialTmp = useRef(new THREE.Vector3());
  const colorTmp = useRef(new THREE.Color());
  const camRight = useRef(new THREE.Vector3());

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

          const tInfluence =
            1 - THREE.MathUtils.clamp(dist / surfaceInfluence, 0, 1);
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
          const speedT = THREE.MathUtils.clamp(
            spd / (freestreamSpeed * 1.8),
            0,
            1,
          );
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
}

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

function FieldBoundsDebug({ field }: { field: ModelFieldInfo }) {
  return (
    <mesh
      position={field.center}
      scale={[field.radii.x, field.radii.y, field.radii.z]}
    >
      <sphereGeometry args={[1, 24, 16]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.15} />
    </mesh>
  );
}

function CollisionMeshDebug({ geometry }: { geometry: THREE.BufferGeometry }) {
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#00ff9d" wireframe transparent opacity={0.35} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function Scene({
  modelUrl,
  config,
}: {
  modelUrl: string | null;
  config: FlowConfig;
}) {
  const [modelField, setModelField] = useState<ModelFieldInfo | null>(null);

  // Clear stale field immediately when a new model URL is chosen so the old
  // BVH / bounds don't bleed into the new model's streamline calculations.
  useEffect(() => {
    setModelField(null);
  }, [modelUrl]);

  // Dispose the previous model's merged collision geometry when it's replaced.
  const prevModelFieldRef = useRef<ModelFieldInfo | null>(null);
  useEffect(() => {
    const prev = prevModelFieldRef.current;
    if (prev && prev !== modelField) {
      prev.collisionGeometry?.dispose();
    }
    prevModelFieldRef.current = modelField;
  }, [modelField]);

  const handleField = useCallback((f: ModelFieldInfo) => setModelField(f), []);

  const flowDirection = useMemo(
    () => directionFromYawPitch(config.flowYawDeg, config.flowPitchDeg),
    [config.flowYawDeg, config.flowPitchDeg],
  );
  const { right, up } = useMemo(
    () => orthonormalBasis(flowDirection),
    [flowDirection],
  );

  const enrichedField: FieldContextValue | null = useMemo(() => {
    if (!modelField) return null;
    return { ...modelField, flowDirection, right, up };
  }, [modelField, flowDirection, right, up]);

  return (
    <>
      <color attach="background" args={["#0a0e14"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <Grid
        infiniteGrid
        fadeDistance={20}
        cellColor="#1c2430"
        sectionColor="#2a3644"
        position={[0, -2, 0]}
      />

      {modelUrl && (
        <Suspense
          fallback={
            <Html center>
              <div style={{ color: "white", fontFamily: "sans-serif" }}>
                Loading model…
              </div>
            </Html>
          }
        >
          <Model url={modelUrl} onField={handleField} />
        </Suspense>
      )}

      {modelField && config.showFieldBounds && (
        <FieldBoundsDebug field={modelField} />
      )}
      {modelField?.collisionGeometry && config.showCollisionMesh && (
        <CollisionMeshDebug geometry={modelField.collisionGeometry} />
      )}
      {enrichedField && (
        <FieldContext.Provider value={enrichedField}>
          <StreamlineField
            count={config.streamlineCount}
            freestreamSpeed={config.freestreamSpeed}
            trailLength={config.trailLength}
            colorBySpeed={config.colorBySpeed}
            surfaceInfluence={config.surfaceInfluence}
            repulsionStrength={config.repulsionStrength}
          />
        </FieldContext.Provider>
      )}

      <OrbitControls makeDefault minDistance={1} maxDistance={30} />
      <Environment preset="city" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export const AeroVisualizationBVH = () => {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<FlowConfig>(DEFAULT_CONFIG);
  const objectUrlRef = useRef<string | null>(null);

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setModelUrl(url);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <Canvas camera={{ position: [4, 2, 4], fov: 45 }}>
        <Scene modelUrl={modelUrl} config={config} />
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          background: "rgba(10,14,20,0.85)",
          color: "white",
          padding: "16px 18px",
          borderRadius: 10,
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          width: 260,
          backdropFilter: "blur(6px)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
          Aero Streamline Viewer (BVH)
        </div>

        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ marginBottom: 4, opacity: 0.8 }}>
            Load model (.glb/.gltf)
          </div>
          <input
            type="file"
            accept=".glb,.gltf"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ width: "100%" }}
          />
        </label>

        <div style={{ marginBottom: 4, opacity: 0.8, marginTop: 4 }}>
          Flow direction
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 10,
          }}
        >
          {FLOW_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  flowYawDeg: p.yaw,
                  flowPitchDeg: p.pitch,
                }))
              }
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background:
                  config.flowYawDeg === p.yaw && config.flowPitchDeg === p.pitch
                    ? "#2b6cff"
                    : "rgba(255,255,255,0.06)",
                color: "white",
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <ControlSlider
          label="Flow yaw (°)"
          min={-180}
          max={180}
          step={1}
          value={config.flowYawDeg}
          onChange={(v) => setConfig((c) => ({ ...c, flowYawDeg: v }))}
        />
        <ControlSlider
          label="Flow pitch (°)"
          min={-85}
          max={85}
          step={1}
          value={config.flowPitchDeg}
          onChange={(v) => setConfig((c) => ({ ...c, flowPitchDeg: v }))}
        />

        <ControlSlider
          label="Streamlines"
          min={20}
          max={800}
          step={20}
          value={config.streamlineCount}
          onChange={(v) => setConfig((c) => ({ ...c, streamlineCount: v }))}
        />
        <ControlSlider
          label="Flow speed"
          min={0.3}
          max={4}
          step={0.1}
          value={config.freestreamSpeed}
          onChange={(v) => setConfig((c) => ({ ...c, freestreamSpeed: v }))}
        />
        <ControlSlider
          label="Trail length"
          min={10}
          max={150}
          step={5}
          value={config.trailLength}
          onChange={(v) => setConfig((c) => ({ ...c, trailLength: v }))}
        />
        <ControlSlider
          label="Surface influence"
          min={0.05}
          max={0.6}
          step={0.01}
          value={config.surfaceInfluence}
          onChange={(v) => setConfig((c) => ({ ...c, surfaceInfluence: v }))}
        />
        <ControlSlider
          label="Repulsion strength"
          min={0.2}
          max={4}
          step={0.1}
          value={config.repulsionStrength}
          onChange={(v) => setConfig((c) => ({ ...c, repulsionStrength: v }))}
        />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
          }}
        >
          <input
            type="checkbox"
            checked={config.showFieldBounds}
            onChange={(e) =>
              setConfig((c) => ({ ...c, showFieldBounds: e.target.checked }))
            }
          />
          Show far-field ellipsoid
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
          }}
        >
          <input
            type="checkbox"
            checked={config.showCollisionMesh}
            onChange={(e) =>
              setConfig((c) => ({ ...c, showCollisionMesh: e.target.checked }))
            }
          />
          Show collision mesh
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
          }}
        >
          <input
            type="checkbox"
            checked={config.colorBySpeed}
            onChange={(e) =>
              setConfig((c) => ({ ...c, colorBySpeed: e.target.checked }))
            }
          />
          Color by speed
        </label>

        {!modelUrl && (
          <div style={{ marginTop: 12, opacity: 0.6, lineHeight: 1.4 }}>
            Load a .glb/.gltf, then use the presets or sliders above to set
            which direction the flow travels. The yellow arrow shows the current
            flow direction.
          </div>
        )}
      </div>
    </div>
  );
};

function ControlSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          opacity: 0.8,
        }}
      >
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}
