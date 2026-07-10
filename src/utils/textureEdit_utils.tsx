import { Texture } from "three";

export type TextureImageSrc = {
  src: string;
  // Whether the caller created `src` (a fresh blob from canvas.toBlob())
  // and therefore owns it / must URL.revokeObjectURL() it when done. False
  // for the <img> fast path below, where `src` is the SAME blob URL
  // GLTFLoader itself created and is still relying on internally to keep
  // the texture's pixel data available - revoking someone else's object
  // URL breaks it for them too. This matters specifically on browsers
  // where GLTFLoader falls back to an HTMLImageElement-based loader
  // instead of ImageBitmapLoader (Safari < 17, including all iOS browsers
  // regardless of which one you're using, since they're all WebKit under
  // the hood) - revoking it there causes a later re-load of the same src
  // to fail with net::ERR_FILE_NOT_FOUND.
  owned: boolean;
};

// toBlob() encodes off the main thread (unlike toDataURL, which encodes
// synchronously inline), so large textures don't stall the UI while
// converting. Callers must URL.revokeObjectURL() the result when done, but
// only if `owned` is true - see TextureImageSrc.owned.
export const textureToImageSrc = (texture: Texture): Promise<TextureImageSrc> => {
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap;

  // cheapest path: already an <img>, just reuse its src
  if (image instanceof HTMLImageElement) {
    return Promise.resolve({ src: image.src, owned: false });
  }

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
      resolve({ src: URL.createObjectURL(blob), owned: true });
    });
  });
};
