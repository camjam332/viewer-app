import type { SparkRenderer } from "@sparkjsdev/spark";
import type { WebGLRenderer } from "three";
import { create } from "zustand";

type SparkState = {
  renderer: SparkRenderer | null;
  setRenderer: (renderer: SparkRenderer) => void;
};

export const useSpark = create<SparkState>((set) => ({
  renderer: null,
  setRenderer: (renderer) => set({ renderer: renderer }),
}));
