type ModelSwitchConfirmDialogProps = {
  reasons: string[];
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Switching models resets a lot of state - most of it silently, and most
 * of it fine to lose without ceremony. This only appears when at least
 * one of a small set of genuinely valuable things (floater cleanup
 * results, a manual orientation correction, an in-progress measurement,
 * annotations on an uploaded model) would actually be discarded -
 * requestModelChange in App.tsx decides that, this just presents it.
 */
export const ModelSwitchConfirmDialog = ({
  reasons,
  onCancel,
  onConfirm,
}: ModelSwitchConfirmDialogProps) => {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-black/80 p-4 text-white backdrop-blur">
        <h1 className="text-lg font-semibold md:text-xl">Switch models?</h1>
        <p className="mt-2 text-sm text-white/70">Switching will discard:</p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/70">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
          >
            Switch Anyway
          </button>
        </div>
      </div>
    </div>
  );
};
