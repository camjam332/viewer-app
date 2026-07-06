import { useState } from "react";
import { ChevronDown } from "lucide-react";

export type ModelOption = {
  modelUrl: string;
  name: string;
  screenshotUrl?: string;
};

type ModelPickerProps = {
  models: ModelOption[];
  modelUrl: string | null;
  setModelUrl: (url: string) => void;
};

export const ModelPicker = ({
  models,
  modelUrl,
  setModelUrl,
}: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const selected = models.find((m) => m.modelUrl === modelUrl);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded bg-white/10 px-3 py-1 text-white hover:bg-white/20"
        onClick={() => setOpen((v) => !v)}
      >
        {selected?.screenshotUrl ? (
          <img
            src={selected.screenshotUrl}
            alt={selected.name}
            className="h-5 w-5 rounded object-cover"
          />
        ) : null}
        <span>{selected?.name ?? "Select model"}</span>
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
                  <div className="h-8 w-8 rounded bg-white/10" />
                )}
                <span>{model.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
