import type { RefObject } from "react";
import type { Group } from "three";
import { GLTFExporter } from "three/examples/jsm/Addons.js";

export const handleExport = (modelRef: RefObject<Group | null>) => {
  const model = modelRef.current;
  if (!model) return;
  const exporter = new GLTFExporter();

  // Export just the model group (not the full r3f scene - camera, grid,
  // environment, transform gizmo, annotation markers, etc. aren't part of
  // the model and shouldn't end up in the file).
  exporter.parse(
    model,
    (gltf) => {
      // 3. Trigger a browser download of the generated JSON file
      const blob = new Blob([JSON.stringify(gltf)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "my-scene.gltf";
      link.click();
    },
    (error) => console.error("An error occurred during export:", error),
    { binary: false }, // Set to true if you want to export a binary .glb file instead
  );
};
