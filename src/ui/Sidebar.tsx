import { useViewer } from "../state/state";

export const Sidebar = () => {
  const annotations = useViewer((s) => s.annotations);
  const setSelectedId = useViewer((s) => s.setSelectedId);
  const updateAnnotation = useViewer((s) => s.updateAnnotation);
  const removeAnnotation = useViewer((s) => s.removeAnnotation);
  const setFocusedId = useViewer((s) => s.setFocusedId);
  const selectedId = useViewer((s) => s.selectedId);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div
      className="fixed z-10 bg-black/70 text-white backdrop-blur
                bottom-0 left-0 right-0 max-h-[50vh] overflow-y-auto p-4
                md:bottom-auto md:left-auto md:top-4 md:right-4 md:w-72 md:max-h-[80vh] md:rounded-lg"
    >
      <h1 className="bg-black/70 text-white px-3 rounded">Annotations</h1>
      {annotations.map((a) => {
        return (
          <div key={a.id}>
            <p
              className={`cursor-pointer px-3 py-2 rounded ${
                selectedId === a.id
                  ? "bg-blue-600"
                  : "bg-white/10 hover:bg-white/20"
              }`}
              onClick={() => setSelectedId(a.id)}
            >
              {a.title}
            </p>
            {selected && selected.id === a.id && (
              <div>
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
                  className="rounded bg-blue-600 px-3 py-1 mt-2"
                  onClick={() => setFocusedId(selected.id)}
                >
                  Focus
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
