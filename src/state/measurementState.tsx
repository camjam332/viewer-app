import type { Vector3 } from "three";
import { create } from "zustand";
import { snapToNearestVertex } from "../utils/utils";

type MeasurementState = {
  mode: "linear" | "geodesic";
  setMeasurementMode: (m: "linear" | "geodesic") => void;
  points: Vector3[];
  addPoint: (p: Vector3) => void;
  clearPoints: () => void;
  adjacencyMap: any;
};

export const useMeasurement = create<MeasurementState>((set) => ({
  mode: "linear",
  setMeasurementMode: (mode) => set({ mode }),
  points: [],
  addPoint: (p) =>
    set((s) => ({
      points: s.points.length === 2 ? [p] : [...s.points, p],
    })),
  clearPoints: () => set({ points: [] }),
  adjacencyMap: null,
}));
