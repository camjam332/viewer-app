import { create } from "zustand";
import type { FlowConfig } from "../utils/aerodynamics_utils";

export const DEFAULT_CONFIG: FlowConfig = {
  streamlineCount: 260,
  freestreamSpeed: 1.6,
  trailLength: 60,
  showFieldBounds: false,
  showCollisionMesh: false,
  colorBySpeed: true,
  surfaceInfluence: 0.22,
  repulsionStrength: 1.4,
  flowYawDeg: -90,
  flowPitchDeg: 0,
};

type AeroState = {
  config: FlowConfig;
  setConfig: (
    config: Partial<FlowConfig> | ((config: FlowConfig) => Partial<FlowConfig>),
  ) => void;
};

export const useAero = create<AeroState>((set) => ({
  config: DEFAULT_CONFIG,
  setConfig: (f) =>
    set((state) => ({
      config: {
        ...state.config,
        ...(typeof f === "function" ? f(state.config) : f),
      },
    })),
}));
