import {
  useRef,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { RefObject } from "react";
import { invalidate, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useVertexDrag } from "../../utils/meshDeform_utils";
import { useViewer } from "../../state/state";

export interface DeformableMeshHandle {
  reset: () => void;
}

interface DeformableMeshOverlayProps {
  mesh: THREE.Mesh;
  pickThreshold: number;
  showWireframe: boolean;
  onDeform?: (
    geometry: THREE.BufferGeometry,
    index: number,
    mesh: THREE.Mesh,
  ) => void;
  onDragEnd?: (geometry: THREE.BufferGeometry, mesh: THREE.Mesh) => void;
}

/**
 * Per-mesh wireframe + drag-pickable point overlay. Does NOT render the
 * mesh itself -- `mesh` is assumed to already be parented and rendered
 * elsewhere (its own loaded hierarchy), so this only adds an editing
 * overlay on top, kept aligned to the mesh via its world matrix every
 * frame. That avoids re-parenting the mesh (which would drop whatever
 * transform it inherits from its actual ancestors in a multi-mesh model).
 *
 * Assumes it's mounted with an identity-transform parent chain (e.g.
 * directly under the Canvas root, as DeformableModel renders it) so that
 * copying the mesh's matrixWorld into this overlay's local matrix lines
 * the two up exactly.
 */
const DeformableMeshOverlay = forwardRef<
  DeformableMeshHandle,
  DeformableMeshOverlayProps
>(({ mesh, pickThreshold, showWireframe, onDeform, onDragEnd }, ref) => {
  const groupRef = useRef<THREE.Group>(null);
  const pointsMaterialRef = useRef<THREE.PointsMaterial>(null);
  const { raycaster } = useThree();

  useFrame(() => {
    if (!groupRef.current) return;
    mesh.updateWorldMatrix(true, false);
    groupRef.current.matrix.copy(mesh.matrixWorld);
    raycaster.params.Points.threshold = pickThreshold;
  });

  const geometry = mesh.geometry;

  // Snapshot for reset. Re-taken whenever a different mesh/geometry comes in.
  const originalPositions = useMemo(
    () => geometry.attributes.position.array.slice(),
    [geometry],
  );

  const handleDeform = useCallback(
    (geo: THREE.BufferGeometry, index: number) => {
      // Default: keep shading correct as vertices move. Swap for a throttled
      // version, or move it to onDragEnd, if this mesh is dense enough for
      // computeVertexNormals() to show up in a profile. If you're using
      // three-mesh-bvh, this is also where boundsTree.refit() belongs.
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      onDeform?.(geo, index, mesh);
      invalidate();
    },
    [onDeform, mesh],
  );

  const handleDragEnd = useCallback(
    (geo: THREE.BufferGeometry) => onDragEnd?.(geo, mesh),
    [onDragEnd, mesh],
  );

  // The overlay group's own matrixWorld is kept equal to the mesh's (see
  // useFrame above), so dragging against IT lands vertices in the same
  // local space the mesh's geometry is actually interpreted in.
  const { bindPointsProps } = useVertexDrag(
    groupRef as RefObject<THREE.Object3D>,
    geometry,
    { pickThreshold, onDeform: handleDeform, onDragEnd: handleDragEnd },
  );

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        geometry.attributes.position.array.set(originalPositions);
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
      },
    }),
    [geometry, originalPositions],
  );

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      {showWireframe && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            color="white"
            wireframe
            transparent
            opacity={0.25}
          />
        </mesh>
      )}
      {/* Picked directly via raycasting -- Points intersections return `.index` */}
      <points geometry={geometry} {...bindPointsProps}>
        <pointsMaterial
          ref={pointsMaterialRef}
          color="white"
          size={pickThreshold * 2.0}
          sizeAttenuation
        />
      </points>
    </group>
  );
});
DeformableMeshOverlay.displayName = "DeformableMeshOverlay";

export interface DeformableModelProps {
  /** A single mesh, or a loaded model (Group) containing one or more
   *  meshes -- every Mesh found inside it gets its own wireframe + drag
   *  overlay. Each mesh's existing geometry, material, and transform are
   *  preserved as-is. */
  object: THREE.Object3D;
  /** Set to false if `object` is already rendered elsewhere in the scene
   *  (e.g. the same model driving the main viewport) - this then only adds
   *  the editing overlay instead of also mounting/re-parenting `object`
   *  here, which would fight with wherever it's already attached. Defaults
   *  to true, matching the old single-mesh, render-it-yourself behavior. */
  renderObject?: boolean;
  pickThreshold?: number;
  showWireframe?: boolean;
  /** See DeformableMeshOverlayProps.cameraDistanceRef. */
  cameraDistanceRef?: RefObject<number>;
  onDeform?: (
    geometry: THREE.BufferGeometry,
    index: number,
    mesh: THREE.Mesh,
  ) => void;
  onDragEnd?: (geometry: THREE.BufferGeometry, mesh: THREE.Mesh) => void;
}

/**
 * Adds click-and-drag vertex editing to every mesh inside `object` -- a
 * single mesh or a whole loaded model with several meshes. Each mesh gets
 * an independent wireframe + picking overlay; dragging a vertex only ever
 * touches the geometry of the mesh it belongs to.
 *
 * Note: meshes with duplicate vertices at UV seams or hard edges (common in
 * glTF exports, and in three.js's own polyhedron geometries) will show a
 * crack when you drag a vertex, since only one of the duplicates moves. If
 * that applies to your model, weld coincident positions into groups first
 * and move every index in a group together -- happy to add that as a
 * preprocessing step here if you want it.
 */
export const DeformableModel = forwardRef<
  DeformableMeshHandle,
  DeformableModelProps
>(
  (
    {
      object,
      renderObject = true,
      pickThreshold = 0.015,
      showWireframe = true,
      onDeform,
      onDragEnd,
    },
    ref,
  ) => {
    const meshes = useMemo(() => {
      const found: THREE.Mesh[] = [];
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) found.push(child as THREE.Mesh);
      });
      return found;
    }, [object]);

    const overlayHandles = useRef(new Map<string, DeformableMeshHandle>());

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          overlayHandles.current.forEach((handle) => handle.reset());
        },
      }),
      [],
    );

    return (
      <>
        {renderObject && <primitive object={object} />}
        {meshes.map((mesh) => (
          <DeformableMeshOverlay
            key={mesh.uuid}
            ref={(handle) => {
              if (handle) overlayHandles.current.set(mesh.uuid, handle);
              else overlayHandles.current.delete(mesh.uuid);
            }}
            mesh={mesh}
            pickThreshold={pickThreshold}
            showWireframe={showWireframe}
            onDeform={onDeform}
            onDragEnd={onDragEnd}
          />
        ))}
      </>
    );
  },
);
DeformableModel.displayName = "DeformableModel";

interface MeshDeformationProps {
  /** Pass your own mesh or loaded model to make it editable. Falls back to
   *  a flat grid plane if omitted, just for standalone testing. */
  object?: THREE.Object3D;
  /** See DeformableModelProps.renderObject. */
  renderObject?: boolean;
}

export const MeshDeformation = ({
  object,
  renderObject,
}: MeshDeformationProps) => {
  const meshHandleRef = useRef<DeformableMeshHandle>(null);
  const markerScale = useViewer((s) => s.markerScale);

  const fallbackMesh = useMemo(() => {
    if (object) return null;
    const geo = new THREE.PlaneGeometry(6, 6, 22, 22);
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: "#4f7cff",
      flatShading: true,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    return new THREE.Mesh(geo, mat);
  }, [object]);

  const activeObject = object ?? fallbackMesh!;

  return (
    <DeformableModel
      ref={meshHandleRef}
      object={activeObject}
      renderObject={renderObject}
      pickThreshold={0.005 * markerScale}
    />
  );
};
