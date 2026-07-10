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

// Snapshot of each texture's pixels as they were the moment its canvas was
// first registered (i.e. before any painting). The eraser paints these
// pixels back rather than a flat color, so erasing reveals the original
// texture instead of leaving a solid patch.
const originalCanvasRegistry = new Map<string, HTMLCanvasElement>();

export const registerTextureCanvas = (
  uuid: string,
  canvas: HTMLCanvasElement,
) => {
  canvasRegistry.set(uuid, canvas);
  if (!originalCanvasRegistry.has(uuid)) {
    const snapshot = document.createElement("canvas");
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
    originalCanvasRegistry.set(uuid, snapshot);
  }
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
  // Crop [x,y,w,h] straight out of the live canvas via WebGL2's unpack
  // skip/row-length pixel-store params, instead of ctx.getImageData(): this
  // canvas is also a visible, actively-composited on-screen element (see
  // registerTextureCanvas), and getImageData forces the browser to
  // synchronously flush its own GPU pipeline and copy pixels back to CPU
  // memory to satisfy that read - costing tens of ms per call. Uploading
  // straight from the canvas element skips that CPU round-trip entirely.
  renderer.state.pixelStorei(gl.UNPACK_ROW_LENGTH, canvas.width);
  renderer.state.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
  renderer.state.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  renderer.state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  renderer.state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  renderer.state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
};

const strokePath = (
  ctx: CanvasRenderingContext2D,
  from: PaintPoint | null,
  to: PaintPoint,
  brushSize: number,
) => {
  ctx.lineWidth = brushSize;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (from) {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  } else {
    // no previous point (first sample of a stroke) - leave a dot instead
    // of nothing
    ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }
};

// Reused across erase calls instead of allocating a new canvas per stroke
// sample. Sized to a "capacity" that only grows, never shrinks - resizing a
// canvas element (setting .width/.height) forces a full backing-store
// reallocation, which is expensive enough on its own to reintroduce the
// same kind of per-sample GPU/canvas stall the dirty-rect upload fix was
// meant to eliminate. The dirty rect's exact size varies continuously with
// stroke direction, so sizing to it exactly would reallocate on nearly
// every sample.
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCapacityW = 0;
let scratchCapacityH = 0;

const getScratchCanvas = (w: number, h: number): HTMLCanvasElement => {
  if (!scratchCanvas) scratchCanvas = document.createElement("canvas");
  if (w > scratchCapacityW || h > scratchCapacityH) {
    scratchCapacityW = Math.max(w, scratchCapacityW);
    scratchCapacityH = Math.max(h, scratchCapacityH);
    scratchCanvas.width = scratchCapacityW;
    scratchCanvas.height = scratchCapacityH;
  }
  return scratchCanvas;
};

// "Erasing" means revealing the original texture, not painting a flat
// color. Draws the brush shape (opaque, any color) onto a small scratch
// canvas sized to the dirty rect, then uses 'source-in' compositing to
// replace those opaque pixels with the matching region of the original
// texture snapshot, and finally composites just that onto the live canvas -
// so only the pixels actually under the brush are touched.
const eraseRegion = (
  liveCanvas: HTMLCanvasElement,
  texture: Texture,
  from: PaintPoint | null,
  to: PaintPoint,
  brushSize: number,
  rect: { x: number; y: number; w: number; h: number },
) => {
  const original = originalCanvasRegistry.get(texture.uuid);
  const liveCtx = liveCanvas.getContext("2d");
  if (!original || !liveCtx) return;

  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(liveCanvas.width, Math.ceil(rect.x + rect.w)) - x;
  const h = Math.min(liveCanvas.height, Math.ceil(rect.y + rect.h)) - y;
  if (w <= 0 || h <= 0) return;

  const scratch = getScratchCanvas(w, h);
  const sctx = scratch.getContext("2d");
  if (!sctx) return;

  sctx.clearRect(0, 0, w, h);
  sctx.globalCompositeOperation = "source-over";
  sctx.fillStyle = "#000";
  sctx.strokeStyle = "#000";
  sctx.save();
  sctx.translate(-x, -y);
  strokePath(sctx, from, to, brushSize);
  sctx.restore();

  sctx.globalCompositeOperation = "source-in";
  sctx.drawImage(original, x, y, w, h, 0, 0, w, h);
  sctx.globalCompositeOperation = "source-over";

  liveCtx.drawImage(scratch, 0, 0, w, h, x, y, w, h);
};

export const drawStroke = (
  canvas: HTMLCanvasElement,
  texture: Texture,
  from: PaintPoint | null,
  to: PaintPoint,
  brushSize: number,
  brushColor: string,
  erase = false,
) => {
  const pad = brushSize / 2 + 1;
  let dirtyRect;
  if (from) {
    const minX = Math.min(from.x, to.x) - pad;
    const minY = Math.min(from.y, to.y) - pad;
    dirtyRect = {
      x: minX,
      y: minY,
      w: Math.max(from.x, to.x) + pad - minX,
      h: Math.max(from.y, to.y) + pad - minY,
    };
  } else {
    dirtyRect = { x: to.x - pad, y: to.y - pad, w: pad * 2, h: pad * 2 };
  }

  if (erase) {
    eraseRegion(canvas, texture, from, to, brushSize, dirtyRect);
  } else {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = brushColor;
    ctx.strokeStyle = brushColor;
    strokePath(ctx, from, to, brushSize);
  }
  uploadDirtyRegion(texture, canvas, dirtyRect);
};
