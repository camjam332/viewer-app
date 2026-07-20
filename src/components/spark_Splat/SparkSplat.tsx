import { useEffect, useState, type Ref } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { SplatMesh, type SplatFileType } from "@sparkjsdev/spark";

type SparkSplatParams = {
  ref?: Ref<SplatMesh> | null;
  url: string;
  // Only needed for uploaded blob URLs, which carry no extension for
  // Spark's own getSplatFileTypeFromPath to key off of, and no magic-byte
  // signature for .splat/.ksplat specifically. Static asset URLs (the
  // picker's own models) don't need this - Spark infers it from the path.
  fileType?: SplatFileType;
  onLoad?: (mesh: SplatMesh) => void;
  onError?: (error: unknown) => void;
  // Fires as bytes download/decode - standard DOM ProgressEvent
  // (.loaded/.total/.lengthComputable), sourced from Spark's own worker
  // reporting real byte counts back via postMessage. Included in the
  // loading effect's dependency array below, same as onLoad/onError - the
  // caller needs to keep this stable (useCallback) or it'll tear down and
  // restart the load on every re-render, the exact bug class already
  // root-caused twice this session for onLoad and onSplatClick.
  onProgress?: (event: ProgressEvent) => void;
  // SplatMesh implements a real, standards-compliant Object3D.raycast()
  // (confirmed from source - pushes {distance, point, object} into the
  // intersects array like any normal mesh), so R3F's own pointer event
  // system works natively here. No custom DOM-level click handling or
  // internal-API reaching-in needed, unlike the GaussianSplats3D wrapper.
  // One real difference worth knowing: this raycast doesn't return a
  // normal or a per-splat index the way GaussianSplats3D's did - just
  // distance/point/object. If you need those, that's a gap this wrapper
  // doesn't currently fill.
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
};

/**
 * Wraps Spark's SplatMesh so a splat scene sits in the R3F scene graph
 * like any other object3D. Requires a <SparkScene> mounted somewhere else
 * in the same Canvas - SparkSplat only creates the SplatMesh, not the
 * renderer that actually draws it.
 *
 * Mount this keyed by `url` from the parent (`<SparkSplat key={url} .../>`)
 * when switching splat scenes, rather than hot-swapping inside one
 * instance - same reasoning as the GaussianSplats3D wrapper: a clean
 * unmount/remount gives a guaranteed-clean dispose + reload for free.
 */
export const SparkSplat = ({
  ref,
  url,
  fileType,
  onLoad,
  onError,
  onProgress,
  onClick,
  onPointerDown,
  onPointerMove,
}: SparkSplatParams) => {
  const [splat, setSplat] = useState<SplatMesh | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fresh instance per effect run - same StrictMode-safety reasoning as
    // SparkScene and the earlier GaussianSplats3D wrapper. Loading starts
    // immediately at construction here (no separate "add scene" call), so
    // a synthetic StrictMode cleanup just interrupts and disposes this
    // instance before the real mount creates a fresh one.
    // No lod/nonLod here - LOD is never built as part of the initial load
    // (a trace showed the LOD build itself blocking SplatMesh.initialized,
    // and therefore the first render, for 20+ seconds on a scene the size
    // of stump.spz). This always takes Spark's fast decode-only path, so
    // the splat appears as soon as bytes are decoded. LOD is opt-in
    // afterward, via packedSplats.createLodSplats() - see App.tsx's
    // lodEnabled effect.
    const instance = new SplatMesh({
      url,
      fileType,
      onProgress,
    });

    instance.initialized
      .then(() => {
        if (cancelled) return;
        setSplat(instance);
        onLoad?.(instance);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onError?.(error);
      });

    return () => {
      cancelled = true;
      instance.dispose();
    };
  }, [url, fileType, onLoad, onError, onProgress]);

  if (!splat) return null;

  return (
    <primitive
      ref={ref}
      object={splat}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    />
  );
};
