import { Texture } from "three";

// toBlob() encodes off the main thread (unlike toDataURL, which encodes
// synchronously inline), so large textures don't stall the UI while
// converting. Callers own the resulting object URL and must
// URL.revokeObjectURL() it when done.
export const textureToImageSrc = (texture: Texture): Promise<string> => {
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap;

  // cheapest path: already an <img>, just reuse its src
  if (image instanceof HTMLImageElement) return Promise.resolve(image.src);

  const canvas =
    image instanceof HTMLCanvasElement
      ? image
      : (() => {
          const c = document.createElement("canvas");
          c.width = image.width;
          c.height = image.height;
          c.getContext("2d")!.drawImage(image, 0, 0);
          return c;
        })();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode texture canvas to a blob"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    });
  });
};
