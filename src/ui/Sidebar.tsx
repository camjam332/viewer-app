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
      style={{
        position: "fixed",
        top: 128,
        right: 16,
        zIndex: 1,
      }}
    >
      <h1>Annotations</h1>
      {annotations.map((a) => {
        return (
          <div key={a.id}>
            <p
              style={{
                cursor: "pointer",
                background: selectedId === a.id ? "red" : "blue",
                color: "white",
              }}
              onClick={() => setSelectedId(a.id)}
            >
              {a.title}
            </p>
            {selected && selected.id === a.id && (
              <div>
                <label>
                  Title
                  <input
                    value={selected.title}
                    onChange={(e) =>
                      updateAnnotation(selected.id, { title: e.target.value })
                    }
                    type="text"
                  />
                </label>
                <br />
                <label>
                  Note
                  <input
                    value={selected.note}
                    onChange={(e) =>
                      updateAnnotation(selected.id, { note: e.target.value })
                    }
                    type="text"
                  />
                </label>
                <br />
                <button onClick={() => removeAnnotation(selected.id)}>
                  Delete Annotation
                </button>
                <button onClick={() => setFocusedId(selected.id)}>
                  Focus Annotation
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
