import { useRef, type ChangeEvent } from "react";
import { Box } from "lucide-react";
import { detectUploadKind, type UploadKind } from "../utils/uploadFileType";

type ModelUploadProps = {
  onUpload: (url: string, upload: UploadKind) => void;
  onUnsupportedFile?: (filename: string) => void;
};

export const ModelUpload = ({
  onUpload,
  onUnsupportedFile,
}: ModelUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const upload = detectUploadKind(file.name);
    if (!upload) {
      onUnsupportedFile?.(file.name);
      return;
    }
    onUpload(URL.createObjectURL(file), upload);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf,.ply,.spz,.splat,.ksplat,.sog,.sogs"
        className="hidden"
        onChange={handleChange}
      />
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-white hover:bg-white/10"
        onClick={() => inputRef.current?.click()}
      >
        <div className="h-8 w-8 flex justify-center items-center rounded bg-white/10">
          <Box />
        </div>
        <span>Upload Model</span>
      </button>
    </>
  );
};
