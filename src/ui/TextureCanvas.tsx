import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Texture } from "three";
import { useViewer } from "../state/state";
import { useTextureEdit } from "../state/textureEditState";
import {
  beginPaintSession,
  drawStroke,
  endPaintSession,
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
  const tool = useTextureEdit((s) => s.tool);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const requestRender = useViewer((s) => s.requestRender);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );

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

  const getCssPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastPointRef.current = getPoint(e);
    beginPaintSession(texture);
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    setCursorPos(getCssPoint(e));
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
      tool === "eraser",
    );
    lastPointRef.current = point;
    requestRender();
  };

  const handlePointerEnter = (e: PointerEvent<HTMLCanvasElement>) => {
    setCursorPos(getCssPoint(e));
  };

  const stopDrawing = () => {
    if (isDrawingRef.current) {
      endPaintSession(texture);
      requestRender();
    }
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handlePointerLeave = () => {
    stopDrawing();
    setCursorPos(null);
  };

  const canvas = canvasRef.current;
  const cursorSize =
    canvas && canvas.width > 0
      ? brushSize * (canvas.clientWidth / canvas.width)
      : brushSize;

  return (
    <div className="relative w-fit mx-auto">
      <canvas
        ref={canvasRef}
        className={className}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerUp={stopDrawing}
        onPointerLeave={handlePointerLeave}
      />
      {cursorPos && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-white mix-blend-difference"
          style={{
            width: cursorSize,
            height: cursorSize,
            left: cursorPos.x - cursorSize / 2,
            top: cursorPos.y - cursorSize / 2,
          }}
        />
      )}
    </div>
  );
};
