import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { SparkRenderer } from "@sparkjsdev/spark";
import { useSpark } from "../../state/sparkState";

/**
 * Mounts a single SparkRenderer for the whole scene.
 *
 * Unlike GaussianSplats3D's DropInViewer (one instance per splat scene),
 * Spark's architecture expects exactly one SparkRenderer per WebGLRenderer,
 * with individual SplatMesh instances added as ordinary scene members
 * alongside it - not nested inside it. Confirmed from source
 * (SparkRenderer.onBeforeRender receives the actual `scene` THREE.js
 * passes in during a normal render() call and discovers SplatMesh/
 * SplatGenerator instances from there), so SparkRenderer and any
 * <SparkSplat> elements just need to coexist in the same scene, not be
 * nested under one another.
 *
 * Mount this ONCE, near the top of your Canvas tree (alongside things
 * like CameraControls) - not per splat, and not per SparkSplat mount.
 *
 * Fresh instance created inside the effect (not via a stable useState
 * instance) for the same reason established with GaussianSplats3D's
 * DropInViewer: under React StrictMode's dev-mode double-invoke
 * (mount -> cleanup -> mount), a useState-cached instance would get
 * dispose()'d by the synthetic cleanup and then incorrectly reused for
 * the real mount that follows.
 */
export const SparkScene = () => {
  const gl = useThree((s) => s.gl);
  const setRenderer = useSpark((s) => s.setRenderer);
  const renderer = useSpark((s) => s.renderer);

  useEffect(() => {
    const instance = new SparkRenderer({ renderer: gl });
    setRenderer(instance);
    return () => {
      instance.dispose();
    };
  }, [gl]);

  if (!renderer) return null;
  return <primitive object={renderer} />;
};
