import {
  LinearFilter,
  MirroredRepeatWrapping,
  RepeatWrapping,
  type Texture,
  type WebGLRenderer,
} from "three";

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

// Lets drawStroke reach the live WebGLRenderer so it can upload just the
// changed pixels instead of going through three.js's texture.needsUpdate
// path, which always re-uploads the *entire* canvas (see below).
let activeRenderer: WebGLRenderer | null = null;

export const registerRenderer = (renderer: WebGLRenderer) => {
  activeRenderer = renderer;
};

const getWebGLTexture = (texture: Texture): WebGLTexture | undefined => {
  const props = activeRenderer?.properties.get(texture) as
    | Record<string, unknown>
    | undefined;
  return props?.__webglTexture as WebGLTexture | undefined;
};

export type PaintPoint = { x: number; y: number };

// While a stroke is in progress, only the base mip level gets updated (see
// uploadDirtyRegion below) - the rest of the mip chain goes stale. That's
// invisible up close (the GPU samples level 0 for magnification) but shows
// as the stroke not appearing until pointerup when the camera is far enough
// that the GPU minifies through a coarser, stale mip level. Mip quality
// doesn't matter mid-stroke, so force the GPU sampler to a non-mipmapped
// filter for the duration and only pay for one full mip rebuild when it
// ends.
const paintSessions = new WeakMap<
  Texture,
  { minFilter: Texture["minFilter"]; generateMipmaps: boolean }
>();

export const beginPaintSession = (texture: Texture) => {
  if (paintSessions.has(texture)) return;
  paintSessions.set(texture, {
    minFilter: texture.minFilter,
    generateMipmaps: texture.generateMipmaps,
  });
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;

  // three.js only pushes texture.minFilter to the GPU during a full upload
  // (see uploadDirtyRegion's comment), which the change above alone won't
  // trigger - so force the already-bound sampler directly. endPaintSession's
  // needsUpdate=true will restore the real minFilter through the normal
  // path once the stroke ends.
  const renderer = activeRenderer;
  const webglTexture = getWebGLTexture(texture);
  if (renderer && webglTexture) {
    const gl = renderer.getContext();
    renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
};

export const endPaintSession = (texture: Texture) => {
  const saved = paintSessions.get(texture);
  if (!saved) return;
  paintSessions.delete(texture);
  texture.generateMipmaps = saved.generateMipmaps;
  texture.minFilter = saved.minFilter;
  texture.needsUpdate = true;
};

// three.js's own upload path (WebGLTextures.js) always calls texSubImage2D
// with the *whole* canvas as the source, regardless of how much actually
// changed - confirmed by reading node_modules/three: `state.texSubImage2D(
// gl.TEXTURE_2D, 0, 0, 0, glFormat, glType, image )`. For a large texture
// that's a multi-megabyte transfer on every single stroke sample, which is
// what was stalling the GPU thread (~80ms/sample, independent of mipmaps).
// Uploading just the dirty rectangle ourselves, via a raw texSubImage2D
// call that bypasses texture.needsUpdate, avoids re-sending the untouched
// 99%+ of the canvas on every sample.
const uploadDirtyRegion = (
  texture: Texture,
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
) => {
  const renderer = activeRenderer;
  const webglTexture = getWebGLTexture(texture);
  if (!renderer || !webglTexture) {
    // No renderer registered yet, or this texture has never been through a
    // full upload (so the GPU resource doesn't exist yet) - fall back to
    // the normal path, which allocates it.
    texture.needsUpdate = true;
    return;
  }

  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(canvas.width, Math.ceil(rect.x + rect.w)) - x;
  const h = Math.min(canvas.height, Math.ceil(rect.y + rect.h)) - y;
  if (w <= 0 || h <= 0) return;

  const ctx = canvas.getContext("2d");
  const imageData = ctx?.getImageData(x, y, w, h);
  if (!imageData) {
    texture.needsUpdate = true;
    return;
  }

  const gl = renderer.getContext();
  // Go through the renderer's cached state wrappers (not raw gl calls) so
  // three.js's own binding/pixel-store cache stays in sync with what we
  // just did here.
  renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture);
  renderer.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
  renderer.state.pixelStorei(
    gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    texture.premultiplyAlpha,
  );
  renderer.state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  renderer.state.pixelStorei(gl.UNPACK_ALIGNMENT, texture.unpackAlignment);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    x,
    y,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    imageData,
  );
};

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
  const pad = brushSize / 2 + 1;
  let dirtyRect;
  if (from) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const minX = Math.min(from.x, to.x) - pad;
    const minY = Math.min(from.y, to.y) - pad;
    dirtyRect = {
      x: minX,
      y: minY,
      w: Math.max(from.x, to.x) + pad - minX,
      h: Math.max(from.y, to.y) + pad - minY,
    };
  } else {
    // no previous point (first sample of a stroke) - leave a dot instead
    // of nothing
    ctx.beginPath();
    ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    dirtyRect = { x: to.x - pad, y: to.y - pad, w: pad * 2, h: pad * 2 };
  }
  uploadDirtyRegion(texture, canvas, dirtyRect);
};
