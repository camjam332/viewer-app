import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Tool = "orbit" | "measure" | "annotate";

export type Annotation = {
  id: string;
  position: [number, number, number];
  normal: [number, number, number];
  title: string;
  note: string;
  // The model this annotation was created against. Used to purge
  // annotations left over from an uploaded (blob: URL) model, since that
  // URL is never valid again after a refresh.
  modelUrl?: string;
};

type ViewerState = {
  modelUrl: string | null;
  setModelUrl: (url: string | null) => void;
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
};

export const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      modelUrl: null,
      setModelUrl: (url) => set({ modelUrl: url, annotations: [] }),
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
    }),
    {
      name: "viewer-storage",
      partialize: (s) => ({ annotations: s.annotations, modelUrl: s.modelUrl }),
    },
  ),
);
