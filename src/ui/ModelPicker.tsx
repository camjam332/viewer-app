import { useEffect, useState } from "react";
import { ChevronDown, Box } from "lucide-react";
import { ModelUpload } from "./ModelUpload";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";

export type ModelOption = {
  modelUrl: string;
  name: string;
  screenshotUrl?: string;
  /** Defaults to "mesh" when omitted - only splats need to set this */
  kind?: "mesh" | "splat";
};

type ModelPickerProps = {
  models: ModelOption[];
  modelUrl: string | null;
  setModelUrl: (url: string) => void;
  uploadedModelUrl: string | null;
  onUploadModel: (url: string) => void;
};

export const ModelPicker = ({
  models,
  modelUrl,
  setModelUrl,
  uploadedModelUrl,
  onUploadModel,
}: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const setIsWireframe = useViewer((s) => s.setIsWireframe);
  const setMeasurementMode = useMeasurement((s) => s.setMeasurementMode);
  const selected = models.find((m) => m.modelUrl === modelUrl);
  const label = uploadedModelUrl
    ? "Uploaded Model"
    : (selected?.name ?? "Select model");

  useEffect(() => {
    setMeasurementMode("linear");
    setIsWireframe(false);
  }, [modelUrl]);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded bg-white/10 px-3 py-1 text-white hover:bg-white/20"
        onClick={() => setOpen((v) => !v)}
      >
        {!uploadedModelUrl && selected?.screenshotUrl ? (
          <img
            src={selected.screenshotUrl}
            alt={selected.name}
            className="h-5 w-5 rounded object-cover"
          />
        ) : null}
        <span>{label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-10 z-20 mt-1 w-56 rounded bg-black/70 p-1 backdrop-blur">
            {models.map((model) => (
              <button
                key={model.modelUrl}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-white ${
                  model.modelUrl === modelUrl
                    ? "bg-white/20"
                    : "hover:bg-white/10"
                }`}
                onClick={() => {
                  setModelUrl(model.modelUrl);
                  setOpen(false);
                }}
              >
                {model.screenshotUrl ? (
                  <img
                    src={model.screenshotUrl}
                    alt={model.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 flex justify-center items-center rounded bg-white/10">
                    <Box />
                  </div>
                )}
                <span>{model.name}</span>
              </button>
            ))}
            <ModelUpload
              onUpload={(url) => {
                onUploadModel(url);
                setOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};
