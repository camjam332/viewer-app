import { useRef, useCallback, useEffect } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useViewer } from "../state/state";

interface UseVertexDragOptions {
  /** Raycast grab radius, passed to raycaster.params.Points.threshold */
  pickThreshold?: number;
  /** Called after every position write during a drag -- e.g. computeVertexNormals(),
   *  boundsTree.refit(), or a throttled version of either for dense meshes. */
  onDeform?: (geometry: THREE.BufferGeometry, index: number) => void;
  /** Called once when a drag ends -- good place for a full recompute you skipped
   *  or throttled during the drag itself. */
  onDragEnd?: (geometry: THREE.BufferGeometry) => void;
}

/**
 * Enables click-and-drag vertex editing on a BufferGeometry.
 *
 * Attach `bindPointsProps` to a <points> object that shares the SAME geometry
 * instance as your mesh -- that's what gets raycast against to pick a vertex
 * index directly (THREE.Points intersections carry `.index`).
 *
 * Usage:
 *   const meshRef = useRef<THREE.Mesh>(null!)
 *   const { bindPointsProps } = useVertexDrag(meshRef, geometry, {
 *     onDeform: (geo) => { geo.computeVertexNormals(); geo.computeBoundingSphere() }
 *   })
 *
 *   <mesh ref={meshRef} geometry={geometry}>...</mesh>
 *   <points geometry={geometry} {...bindPointsProps}>
 *     <pointsMaterial size={0.1} />
 *   </points>
 */
export function useVertexDrag(
  meshRef: React.RefObject<THREE.Object3D>,
  geometry: THREE.BufferGeometry | null,
  options: UseVertexDragOptions = {},
) {
  const markerScale = useViewer((s) => s.markerScale);
  const { pickThreshold = 0.01 * markerScale, onDeform, onDragEnd } = options;
  const { camera, gl, raycaster } = useThree();
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  const dragPlane = useRef(new THREE.Plane());
  const draggedIndex = useRef(-1);
  const pointerNDC = useRef(new THREE.Vector2());

  useEffect(() => {
    raycaster.params.Points.threshold = pickThreshold;
  }, [raycaster, pickThreshold]);

  const setNDCFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointerNDC.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
    },
    [gl],
  );

  // Global (window-level) listeners while dragging, rather than R3F's onPointerMove,
  // so the drag keeps tracking even once the cursor leaves the picked point's hit area.
  const onDragMove = useCallback(
    (event: PointerEvent) => {
      if (draggedIndex.current === -1 || !meshRef.current || !geometry) return;
      setNDCFromEvent(event.clientX, event.clientY);
      raycaster.setFromCamera(pointerNDC.current, camera);

      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane.current, hit)) return;

      const local = meshRef.current.worldToLocal(hit.clone());
      const pos = geometry.attributes.position;
      pos.setXYZ(draggedIndex.current, local.x, local.y, local.z);
      pos.needsUpdate = true;

      onDeform?.(geometry, draggedIndex.current);
    },
    [camera, geometry, raycaster, meshRef, setNDCFromEvent, onDeform],
  );

  const endDrag = useCallback(() => {
    if (draggedIndex.current === -1) return;
    draggedIndex.current = -1;
    gl.domElement.style.cursor = "grab";
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    if (controls) controls.enabled = true;
    if (geometry) onDragEnd?.(geometry);
  }, [gl, onDragMove, geometry, onDragEnd, controls]);

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.index === undefined || !meshRef.current || !geometry) return;
      event.stopPropagation();

      draggedIndex.current = event.index;
      gl.domElement.style.cursor = "grabbing";
      if (controls) controls.enabled = false;

      // Exact world position of the grabbed vertex (not the ray's approximate hit point)
      const vertexLocal = new THREE.Vector3().fromBufferAttribute(
        geometry.attributes.position,
        event.index,
      );
      const worldPoint = meshRef.current.localToWorld(vertexLocal.clone());

      // Drag plane faces the camera and passes through the grabbed vertex
      const camNormal = camera.getWorldDirection(new THREE.Vector3()).negate();
      dragPlane.current.setFromNormalAndCoplanarPoint(camNormal, worldPoint);

      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", endDrag);
    },
    [camera, geometry, gl, meshRef, onDragMove, endDrag, controls],
  );

  // Safety net if the component unmounts mid-drag -- also re-enables
  // controls via endDrag() instead of just tearing down listeners, so a
  // drag that's interrupted by unmount (e.g. switching models) doesn't
  // leave camera controls stuck disabled.
  useEffect(() => endDrag, [endDrag]);

  return { bindPointsProps: { onPointerDown } };
}
