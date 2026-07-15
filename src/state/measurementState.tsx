import type { Vector3 } from "three";
import { create } from "zustand";

type MeasurementState = {
  buildingGraph: boolean;
  setBuildingGraph: (b: boolean) => void;
  mode: "linear" | "geodesic";
  setMeasurementMode: (m: "linear" | "geodesic") => void;
  points: Vector3[];
  addPoint: (p: Vector3) => void;
  clearPoints: () => void;
  surfaceDistance: number | null;
  setSurfaceDistance: (d: number | null) => void;
};

export const useMeasurement = create<MeasurementState>((set) => ({
  buildingGraph: false,
  setBuildingGraph: (b) => set({ buildingGraph: b }),
  mode: "linear",
  setMeasurementMode: (mode) => set({ mode }),
  points: [],
  addPoint: (p) =>
    set((s) => ({
      points: s.points.length === 2 ? [p] : [...s.points, p],
    })),
  clearPoints: () => set({ points: [] }),
  surfaceDistance: null,
  setSurfaceDistance: (d) => set({ surfaceDistance: d }),
}));
