import { MirroredRepeatWrapping, RepeatWrapping, type Texture } from "three";

// glTF's default sampler wrap mode is REPEAT (unlike three.js's own default
// of ClampToEdge), so it's common for UVs to sit outside [0,1] and rely on
// wraparound to land back on the actual image. Mirrors how the GPU samples
// the texture, so painted pixels line up with the same wrapped location.
export const wrapUVCoordinate = (value: number, wrap: number): number => {
  if (wrap === RepeatWrapping) return ((value % 1) + 1) % 1;
  if (wrap === MirroredRepeatWrapping) {
    const wrapped = ((value % 2) + 2) % 2;
    return wrapped > 1 ? 2 - wrapped : wrapped;
  }
  // ClampToEdgeWrapping (three.js's default) and anything unrecognized
  return Math.min(Math.max(value, 0), 1);
};

// Lets any component look up the live drawable <canvas> for a given
// texture by uuid, so painting isn't limited to whichever component
// originally created the canvas (the flat 2D panel vs. the 3D model).
const canvasRegistry = new Map<string, HTMLCanvasElement>();

export const registerTextureCanvas = (
  uuid: string,
  canvas: HTMLCanvasElement,
) => {
  canvasRegistry.set(uuid, canvas);
};

export const unregisterTextureCanvas = (
  uuid: string,
  canvas: HTMLCanvasElement,
) => {
  if (canvasRegistry.get(uuid) === canvas) canvasRegistry.delete(uuid);
};

export const getTextureCanvas = (uuid: string) => canvasRegistry.get(uuid);

export type PaintPoint = { x: number; y: number };

export const drawStroke = (
  canvas: HTMLCanvasElement,
  texture: Texture,
  from: PaintPoint | null,
  to: PaintPoint,
  brushSize: number,
  brushColor: string,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.strokeStyle = brushColor;
  ctx.fillStyle = brushColor;
  ctx.lineWidth = brushSize;
  ctx.lineCap = "round";
  if (from) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  } else {
    // no previous point (first sample of a stroke) - leave a dot instead
    // of nothing
    ctx.beginPath();
    ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  texture.needsUpdate = true;
};
