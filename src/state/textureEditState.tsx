import { create } from "zustand";

type TextureEditState = {
  brushSize: number;
  setBrushSize: (n: number) => void;
  brushColor: string;
  setBrushColor: (s: string) => void;
  activeTextureType: string;
  setActiveTextureType: (s: string) => void;
};

export const useTextureEdit = create<TextureEditState>((set) => ({
  brushSize: 4,
  setBrushSize: (n) => set({ brushSize: n }),
  brushColor: "#ff0000",
  setBrushColor: (s) => set({ brushColor: s }),
  activeTextureType: "map",
  setActiveTextureType: (s) => set({ activeTextureType: s }),
}));
