import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Vector3 } from "three";

export type Tool = "orbit" | "measure" | "annotate";

export type Annotation = {
  id: string;
  position: [number, number, number];
  normal: [number, number, number];
  title: string;
  note: string;
};

type ViewerState = {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  points: Vector3[];
  addPoint: (p: Vector3) => void;
  clearPoints: () => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  annotations: Annotation[];
  addAnnotation: (
    p: [number, number, number],
    n: [number, number, number],
  ) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
};

export const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      points: [],
      addPoint: (p) =>
        set((s) => ({
          points: s.points.length === 2 ? [p] : [...s.points, p],
        })),
      clearPoints: () => set({ points: [] }),
      tool: "orbit",
      setTool: (t) => set({ tool: t }),
      annotations: [],
      addAnnotation: (position, normal) =>
        set((s) => {
          const annotation = {
            id: crypto.randomUUID().toString(),
            position,
            normal,
            title: `New Annotation ${s.annotations.length + 1}`,
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
      selectedId: null,
      setSelectedId: (id: string | null) => set({ selectedId: id }),
      focusedId: null,
      setFocusedId: (id: string | null) => set({ focusedId: id }),
    }),
    {
      name: "viewer-storage",
      partialize: (s) => ({ annotations: s.annotations }),
    },
  ),
);
