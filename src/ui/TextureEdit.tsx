import { Mesh, Texture, type Group } from "three";
import { useViewer } from "../state/state";
import { Fragment, useEffect, useState, type RefObject } from "react";
import { textureToImageSrc } from "../utils/textureEdit_utils";
import { TextureCanvas } from "./TextureCanvas";
import { ControlSlider } from "./ControlSlider";
import { useTextureEdit } from "../state/textureEditState";

type TextureEditParams = {
  modelRef: RefObject<Group | null>;
  modelUrl: string | null;
};

type ExtractedTexture = {
  id: string;
  texture: string;
  textureRef: Texture;
  textureType: string;
};

// Define an array of potential texture map properties to check
const TEXTURE_PROPS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "emissiveMap",
  "displacementMap",
];

export const TextureEdit = ({ modelRef, modelUrl }: TextureEditParams) => {
  const brushSize = useTextureEdit((s) => s.brushSize);
  const brushColor = useTextureEdit((s) => s.brushColor);
  const editTexture = useViewer((s) => s.editTexture);
  const setBrushSize = useTextureEdit((s) => s.setBrushSize);
  const setBrushColor = useTextureEdit((s) => s.setBrushColor);
  const setEditTexture = useViewer((s) => s.setEditTexture);
  const activeTextureType = useTextureEdit((s) => s.activeTextureType);
  const setActiveTextureType = useTextureEdit((s) => s.setActiveTextureType);

  const [textures, setTextures] = useState<ExtractedTexture[]>([]);
  const availableTextureTypes = [
    ...new Set(textures.map((t) => t.textureType)),
  ];

  useEffect(() => {
    if (!modelRef.current || !editTexture) {
      setTextures([]);
      return;
    }

    // Gather the (mesh, material, prop) work items synchronously - cheap,
    // no canvas work happens yet - then convert one texture per animation
    // frame so the expensive canvas/GPU work never blocks the main thread
    // for more than a single texture at a time.
    const seen = new Set<string>();
    const pending: { tex: Texture; textureType: string }[] = [];
    modelRef.current.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      materials.forEach((material) => {
        TEXTURE_PROPS.forEach((prop) => {
          const tex = material[prop] as Texture | undefined;
          if (!tex || seen.has(tex.uuid)) return;
          seen.add(tex.uuid);
          pending.push({ tex, textureType: prop });
        });
      });
    });

    let cancelled = false;
    let frame: number;
    const collected: ExtractedTexture[] = [];

    const processNext = async (index: number) => {
      if (cancelled || index >= pending.length) return;

      const { tex, textureType } = pending[index];
      const src = await textureToImageSrc(tex);
      if (cancelled) {
        URL.revokeObjectURL(src);
        return;
      }
      collected.push({
        id: tex.uuid,
        texture: src,
        textureRef: tex,
        textureType,
      });
      setTextures([...collected]);

      frame = requestAnimationFrame(() => processNext(index + 1));
    };

    processNext(0);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      collected.forEach((t) => URL.revokeObjectURL(t.texture));
    };
  }, [editTexture]);

  useEffect(() => {
    setEditTexture(false);
  }, [modelUrl]);

  useEffect(() => {
    if (availableTextureTypes.length === 0) return;
    if (!availableTextureTypes.includes(activeTextureType)) {
      setActiveTextureType(availableTextureTypes[0]);
    }
  }, [availableTextureTypes, activeTextureType, setActiveTextureType]);

  return modelRef.current && editTexture ? (
    <div className="bg-black/70 max-h-[50vh] md:max-h-[65vh] backdrop-blur rounded-lg p-2 max-w-xs md:max-w-none flex flex-col">
      <p className="text-white text-sm font-medium mb-2 flex-shrink-0">
        Edit Texture
      </p>
      <label className="text-white text-sm font-medium mb-2 flex-shrink-0">
        Choose Color:
      </label>
      <input
        type="color"
        id="colorPicker"
        className="h-10 w-10 cursor-pointer rounded-lg border border-gray-300 bg-transparent p-0 [::-webkit-color-swatch-wrapper]:p-0 [::-webkit-color-swatch]:rounded-lg [::-webkit-color-swatch]:border-none [::-moz-color-swatch]:rounded-lg [::-moz-color-swatch]:border-none"
        value={brushColor}
        onChange={(v) => setBrushColor(v.target.value)}
      />
      <ControlSlider
        label="Brush Size: "
        min={4}
        max={50}
        step={1}
        value={brushSize}
        onChange={(v) => setBrushSize(v)}
      />
      {availableTextureTypes.length > 0 && (
        <label className="text-white text-sm font-medium mb-2 flex-shrink-0">
          Paint Target:
          <select
            className="ml-2 rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
            value={activeTextureType}
            onChange={(e) => setActiveTextureType(e.target.value)}
          >
            {availableTextureTypes.map((type) => (
              <option
                key={type}
                value={type}
                className="rounded bg-black/70 text-white px-2 py-1"
              >
                {type}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
        {textures.map((texture) => (
          <Fragment key={texture.id}>
            <p className="text-white">{texture.textureType}</p>
            <TextureCanvas
              src={texture.texture}
              texture={texture.textureRef}
              className="w-48 h-48 object-cover rounded border border-white/20 cursor-crosshair mx-auto"
            />
          </Fragment>
        ))}
      </div>
    </div>
  ) : null;
};
