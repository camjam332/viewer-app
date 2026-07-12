import { useEffect, useState, type Ref } from "react";
import type { Group } from "three";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

type SplatViewerParams = {
  ref?: Ref<Group> | null;
  url: string;
  onLoad?: () => void;
  onError?: (error: unknown) => void;
};

export const SplatViewer = ({
  ref,
  url,
  onLoad,
  onError,
}: SplatViewerParams) => {
  const [viewer] = useState(
    () =>
      new GaussianSplats3D.DropInViewer({
        sharedMemoryForWorkers: false,
      }),
  );

  useEffect(() => {
    let cancelled = false;

    viewer
      .addSplatScene(url, { progressiveLoad: false })
      .then(() => {
        if (cancelled) return;
        onLoad?.();
        console.log("[sanity check] started");
      })
      .catch((err) => {
        if (cancelled) return;
        onError?.(err);
        console.error("[sanity check] failed:", err);
      });

    return () => {
      cancelled = true;
      void viewer.dispose();
    };
  }, [viewer, url, onLoad, onError]);

  return <primitive ref={ref} object={viewer} />;
};
