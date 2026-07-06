import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useViewer } from "../state/state";
import { useMeasurement } from "../state/measurementState";
import { Vector3 } from "three";

export const Sidebar = () => {
  const annotations = useViewer((s) => s.annotations);
  const setSelectedId = useViewer((s) => s.setSelectedId);
  const updateAnnotation = useViewer((s) => s.updateAnnotation);
  const removeAnnotation = useViewer((s) => s.removeAnnotation);
  const setFocusedId = useViewer((s) => s.setFocusedId);
  const addPoint = useMeasurement((s) => s.addPoint);
  const selectedId = useViewer((s) => s.selectedId);

  const [listOpen, setListOpen] = useState(false);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div
      className="fixed z-10 bg-black/70 text-white backdrop-blur
                bottom-0 left-0 right-0 max-h-[50vh] overflow-y-auto p-2
                md:bottom-auto md:left-auto md:top-4 md:right-4 md:w-72 md:max-h-[80vh] md:rounded-lg"
    >
      <button
        className="flex w-full items-center justify-between rounded px-1 py-1 hover:bg-white/10 transition-colors"
        onClick={() => setListOpen((v) => !v)}
      >
        <h1 className="text-white text-base font-medium">
          Annotations ({annotations.length})
        </h1>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
            listOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {/* grid-rows trick animates height without knowing content size in advance */}
      <div
        className={`grid transition-all duration-200 ease-out ${
          listOpen
            ? "grid-rows-[1fr] opacity-100 mt-2"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {annotations.map((a) => {
            return (
              <p
                key={a.id}
                className={`cursor-pointer px-3 py-2 rounded ${
                  selectedId === a.id
                    ? "bg-blue-600"
                    : "bg-white/10 hover:bg-white/20"
                }`}
                onClick={() => setSelectedId(selectedId === a.id ? null : a.id)}
              >
                {a.title}
              </p>
            );
          })}
        </div>
      </div>

      <div
        className={`grid transition-all duration-200 ease-out ${
          selected && listOpen
            ? "grid-rows-[1fr] opacity-100 mt-2"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {selected && (
            <div className="pt-2">
              <label>
                Title
                <input
                  className="w-full rounded bg-white/10 px-2 py-1 text-white mt-1"
                  value={selected.title}
                  onChange={(e) =>
                    updateAnnotation(selected.id, { title: e.target.value })
                  }
                  type="text"
                />
              </label>
              <label>
                Note
                <input
                  className="w-full rounded bg-white/10 px-2 py-1 text-white mt-1"
                  value={selected.note}
                  onChange={(e) =>
                    updateAnnotation(selected.id, { note: e.target.value })
                  }
                  type="text"
                />
              </label>
              <button
                className="rounded bg-red-600 px-3 py-1 mt-2 mr-2"
                onClick={() => removeAnnotation(selected.id)}
              >
                Delete
              </button>
              <button
                className="rounded bg-blue-600 px-3 py-1 mt-2 mr-2"
                onClick={() => setFocusedId(selected.id)}
              >
                Focus
              </button>
              <button
                className="rounded bg-green-600 px-3 py-1 mt-2 mr-2"
                onClick={() => addPoint(new Vector3(...selected.position))}
              >
                Add Marker
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
