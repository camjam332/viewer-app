import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SplatFileType } from "@sparkjsdev/spark";
import type { ModelOption } from "../ui/ModelPicker";

const models: ModelOption[] = [
  {
    modelUrl:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoomBox/glTF-Binary/BoomBox.glb",
    name: "Boom Box",
    screenshotUrl:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoomBox/screenshot/screenshot.jpg",
  },
  {
    modelUrl:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
    name: "Damaged Helmet",
    screenshotUrl:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/screenshot/screenshot.png",
  },
  {
    modelUrl:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Lantern/glTF-Binary/Lantern.glb",
    name: "Lantern",
    screenshotUrl:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Lantern/screenshot/screenshot.jpg",
  },
  {
    modelUrl: "/models/triceratops_skull.glb",
    name: "Triceratops (Scan)",
    kind: "mesh",
  },
  {
    modelUrl: "/models/cadillac_fleetwood_brougham_1997_pink/scene.gltf",
    name: "Cadillac (Scan)",
    kind: "mesh",
  },
  {
    modelUrl: "/models/nike.spz",
    name: "Nike (Splat)",
    kind: "splat",
    splatViewMode: "object",
  },
  {
    modelUrl: "/models/room.spz",
    name: "Room (Splat)",
    kind: "splat",
    splatViewMode: "interior",
  },
  {
    modelUrl: "/models/stump.spz",
    name: "Stump (Splat)",
    kind: "splat",
    splatViewMode: "interior",
  },
  {
    modelUrl: "/models/fountain_photo.spz",
    name: "Fountain (Splat)",
    kind: "splat",
    splatViewMode: "interior",
  },
  {
    modelUrl: "https://sparkjs.dev/assets/splats/butterfly.spz",
    name: "Butterfly (Splat)",
    kind: "splat",
    splatViewMode: "object",
  },
];

export type Tool = "orbit" | "measure" | "annotate";

export type CameraControlMode = "orbit" | "fly";

export type Annotation = {
  id: string;
  position: [number, number, number];
  normal: [number, number, number];
  title: string;
  note: string;
  modelUrl?: string;
};

type ViewerState = {
  meshDeformation: boolean;
  setMeshDeformation: (b?: boolean) => void;
  transformControlsMode: "translate" | "rotate" | "scale";
  setTransformControlsMode: (s: "translate" | "rotate" | "scale") => void;
  showTransformControls: boolean;
  setShowTransformControls: (b?: boolean) => void;
  // Tracks actual camera motion (drag, momentum/damping settling, wheel
  // zoom) - not just whether the mouse is currently down. Read
  // non-reactively (useViewer.getState().isCameraMoving) at click time
  // by both the mesh and splat click handlers, so a click that lands at
  // the tail end of an orbit drag - or during the brief coasting period
  // after release, before damping settles - doesn't silently add an
  // unwanted measurement point or annotation.
  isCameraMoving: boolean;
  setIsCameraMoving: (moving: boolean) => void;
  editTexture: boolean;
  setEditTexture: (b?: boolean) => void;
  uploadedModelUrl: string | null;
  // Blob URLs carry no extension, so the uploaded file's kind/fileType has
  // to be captured alongside the url at upload time - there's nothing to
  // sniff it back out of later (see detectUploadKind in uploadFileType.ts).
  uploadedModelKind: "mesh" | "splat" | null;
  uploadedSplatFileType: SplatFileType | null;
  setUploadedModelUrl: (
    s: string | null,
    kind?: "mesh" | "splat" | null,
    fileType?: SplatFileType | null,
  ) => void;
  resetCamera: boolean;
  setResetCamera: (b: boolean) => void;
  models: ModelOption[];
  modelUrl: string | null;
  setModelUrl: (url: string | null) => void;
  isWireframe: boolean;
  setIsWireframe: (b?: boolean) => void;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  annotations: Annotation[];
  addAnnotation: (
    p: [number, number, number],
    n: [number, number, number],
    modelUrl?: string,
  ) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  pruneUploadedAnnotations: () => void;
  markerScale: number;
  setMarkerScale: (n: number) => void;
  showAero: boolean;
  setShowAero: (b?: boolean) => void;
  requestRender: () => void;
  setRequestRender: (fn: () => void) => void;
  // Orbit-style CameraControls is the default; fly mode swaps in drei's
  // FlyControls for free WASD+mouse-look navigation. Not persisted -
  // camera-controls-specific features (focus-on-annotation, reset,
  // frame-on-load) only work in orbit mode, see App.tsx's guards.
  cameraControlMode: CameraControlMode;
  setCameraControlMode: (m: CameraControlMode) => void;
};

export const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      meshDeformation: false,
      setMeshDeformation: (b) =>
        set((s) => ({
          meshDeformation: b !== undefined ? b : !s.meshDeformation,
        })),
      transformControlsMode: "translate",
      setTransformControlsMode: (s) => set({ transformControlsMode: s }),
      showTransformControls: false,
      setShowTransformControls: (b) =>
        set((s) => ({
          showTransformControls: b !== undefined ? b : !s.showTransformControls,
        })),
      isCameraMoving: false,
      setIsCameraMoving: (moving) => set({ isCameraMoving: moving }),
      editTexture: false,
      setEditTexture: (b) =>
        set((s) => ({ editTexture: b !== undefined ? b : !s.editTexture })),
      uploadedModelUrl: null,
      uploadedModelKind: null,
      uploadedSplatFileType: null,
      setUploadedModelUrl: (url, kind = null, fileType = null) =>
        set((s) => {
          if (
            s.uploadedModelUrl &&
            s.uploadedModelUrl.startsWith("blob:") &&
            s.uploadedModelUrl !== url
          ) {
            URL.revokeObjectURL(s.uploadedModelUrl);
          }
          return {
            uploadedModelUrl: url,
            uploadedModelKind: kind,
            uploadedSplatFileType: fileType,
          };
        }),
      resetCamera: false,
      setResetCamera: (b) => set({ resetCamera: b }),
      models: models,
      modelUrl: null,
      setModelUrl: (url) => set({ modelUrl: url, annotations: [] }),
      isWireframe: false,
      setIsWireframe: (b) =>
        set((s) => ({ isWireframe: b !== undefined ? b : !s.isWireframe })),
      tool: "orbit",
      setTool: (t) => set({ tool: t }),
      annotations: [],
      addAnnotation: (position, normal, modelUrl) =>
        set((s) => {
          const genId = crypto.randomUUID().toString();
          const annotation = {
            id: genId,
            position,
            normal,
            modelUrl,
            title: `New Annotation ${genId.slice(0, 4)}`,
            note: "",
          };
          return {
            annotations: [...s.annotations, annotation],
            selectedId: annotation.id,
          };
        }),
      updateAnnotation: (id, patch) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
        })),
      removeAnnotation: (id) =>
        set((s) => ({
          annotations: s.annotations.filter((a) => a.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      clearAnnotations: () => set({ annotations: [] }),
      pruneUploadedAnnotations: () =>
        set((s) => ({
          annotations: s.annotations.filter(
            (a) => !a.modelUrl?.startsWith("blob:"),
          ),
        })),
      selectedId: null,
      setSelectedId: (id: string | null) => set({ selectedId: id }),
      focusedId: null,
      setFocusedId: (id: string | null) => set({ focusedId: id }),
      markerScale: 1,
      setMarkerScale: (s) => set({ markerScale: s }),
      showAero: false,
      setShowAero: (b) =>
        set((s) => ({ showAero: b !== undefined ? b : !s.showAero })),
      requestRender: () => {},
      setRequestRender: (fn) => set({ requestRender: fn }),
      cameraControlMode: "orbit",
      setCameraControlMode: (m) => set({ cameraControlMode: m }),
    }),
    {
      name: "viewer-storage",
      partialize: (s) => ({ annotations: s.annotations, modelUrl: s.modelUrl }),
    },
  ),
);
