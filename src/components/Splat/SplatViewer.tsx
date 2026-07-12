import { useEffect, useState, type Ref } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3, type Group } from "three";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

export type SplatHit = {
  point: [number, number, number];
  normal: Vector3;
  splatIndex: number;
  distance: number;
};

type SplatViewerParams = {
  ref?: Ref<Group> | null;
  url: string;
  onLoad?: (viewer: GaussianSplats3D.DropInViewer) => void;
  onError?: (error: unknown) => void;
  onSplatClick?: (hit: SplatHit) => void;
};

export const SplatViewer = ({
  ref,
  url,
  onLoad,
  onError,
  onSplatClick,
}: SplatViewerParams) => {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const [viewer, setViewer] = useState<GaussianSplats3D.DropInViewer | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const instance = new GaussianSplats3D.DropInViewer({
      sharedMemoryForWorkers: false,
    });

    instance
      .addSplatScene(url, { progressiveLoad: false })
      .then(() => {
        if (cancelled) return;
        setViewer(instance);
        onLoad?.(instance);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onError?.(error);
      });

    return () => {
      cancelled = true;
      void instance.dispose();
    };
  }, [url, onLoad, onError]);

  useEffect(() => {
    if (!onSplatClick || !viewer) return;
    const canvas = gl.domElement;

    const handleClick = (event: MouseEvent) => {
      const splatMesh = viewer.splatMesh;
      const raycaster = viewer.viewer?.raycaster;
      if (!splatMesh || !raycaster) return;

      const rect = canvas.getBoundingClientRect();
      const screenPosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const screenDimensions = { x: rect.width, y: rect.height };

      raycaster.setFromCameraAndScreenPosition(
        camera,
        screenPosition,
        screenDimensions,
      );
      const hits = raycaster.intersectSplatMesh(splatMesh, []);
      if (hits.length === 0) return;

      const closest = hits[0];

      onSplatClick({
        point: [closest.origin.x, closest.origin.y, closest.origin.z],
        normal: new Vector3(
          closest.normal.x,
          closest.normal.y,
          closest.normal.z,
        ),
        splatIndex: closest.splatIndex,
        distance: closest.distance,
      });
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [viewer, camera, gl, onSplatClick]);

  if (!viewer) return null;
  return <primitive ref={ref} object={viewer} />;
};
