import { create } from "zustand";
import { Vector3 } from "three";

type ViewerState = {
  points: Vector3[];
  addPoint: (p: Vector3) => void;
  clearPoints: () => void;
};

export const useViewer = create<ViewerState>((set) => ({
  points: [],
  addPoint: (p) =>
    set((s) => ({ points: s.points.length === 2 ? [p] : [...s.points, p] })),
  clearPoints: () => set({ points: [] }),
}));
