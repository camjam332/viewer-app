import { SplatFileType } from "@sparkjsdev/spark";

export type UploadKind =
  | { kind: "mesh" }
  | { kind: "splat"; fileType: SplatFileType };

const MESH_EXTENSIONS = new Set(["glb", "gltf"]);

// Blob URLs (what an uploaded File becomes) carry no extension, and Spark's
// own magic-byte sniffing (getSplatFileType) can't distinguish .splat/.ksplat
// - they're headerless raw binary. So the fileType has to be determined from
// the original File.name up front and threaded through explicitly, rather
// than left for SparkSplat/SplatMesh to infer from the url.
export function detectUploadKind(filename: string): UploadKind | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (MESH_EXTENSIONS.has(ext)) return { kind: "mesh" };
  switch (ext) {
    case "ply":
      return { kind: "splat", fileType: SplatFileType.PLY };
    case "spz":
      return { kind: "splat", fileType: SplatFileType.SPZ };
    case "splat":
      return { kind: "splat", fileType: SplatFileType.SPLAT };
    case "ksplat":
      return { kind: "splat", fileType: SplatFileType.KSPLAT };
    case "sog":
    case "sogs":
      return { kind: "splat", fileType: SplatFileType.PCSOGSZIP };
    default:
      return null;
  }
}
