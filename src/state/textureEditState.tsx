import { create } from "zustand";

export type PaintTool = "brush" | "eraser";

type TextureEditState = {
  brushSize: number;
  setBrushSize: (n: number) => void;
  brushColor: string;
  setBrushColor: (s: string) => void;
  activeTextureType: string;
  setActiveTextureType: (s: string) => void;
  tool: PaintTool;
  setTool: (t: PaintTool) => void;
};

export const useTextureEdit = create<TextureEditState>((set) => ({
  brushSize: 4,
  setBrushSize: (n) => set({ brushSize: n }),
  brushColor: "#ff0000",
  setBrushColor: (s) => set({ brushColor: s }),
  activeTextureType: "map",
  setActiveTextureType: (s) => set({ activeTextureType: s }),
  tool: "brush",
  setTool: (t) => set({ tool: t }),
}));
