import { useEffect, useRef, type PointerEvent } from "react";
import type { Texture } from "three";
import { useViewer } from "../state/state";
import { useTextureEdit } from "../state/textureEditState";
import {
  drawStroke,
  registerTextureCanvas,
  unregisterTextureCanvas,
} from "../utils/texturePaint";

type TextureCanvasParams = {
  src: string;
  texture: Texture;
  className?: string;
};

export const TextureCanvas = ({
  src,
  texture,
  className,
}: TextureCanvasParams) => {
  const brushSize = useTextureEdit((s) => s.brushSize);
  const brushColor = useTextureEdit((s) => s.brushColor);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const requestRender = useViewer((s) => s.requestRender);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const image = new Image();
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
      // Point the live texture's image source at this canvas so future
      // strokes drawn onto it are picked up by the renderer on invalidate.
      texture.image = canvas;
      texture.needsUpdate = true;
      // Makes this canvas paintable from the 3D view too, not just here.
      registerTextureCanvas(texture.uuid, canvas);
      requestRender();
    };
    image.src = src;
    return () => unregisterTextureCanvas(texture.uuid, canvas);
  }, [src, texture, requestRender]);

  const getPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastPointRef.current = getPoint(e);
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastPointRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = getPoint(e);
    drawStroke(
      canvas,
      texture,
      lastPointRef.current,
      point,
      brushSize,
      brushColor,
    );
    lastPointRef.current = point;
    requestRender();
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrawing}
      onPointerLeave={stopDrawing}
    />
  );
};
