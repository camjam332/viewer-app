function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type SplatLoadProgressValue = {
  loaded: number;
  total: number;
  lengthComputable: boolean;
};

type SplatLoadProgressProps = {
  progress: SplatLoadProgressValue | null;
  indeterminateMessage: string | null;
};

/**
 * Shown while a splat is downloading/decoding - separate from drei's
 * existing <Loader/>, which is tied to Three.js's DefaultLoadingManager
 * and doesn't get fine-grained byte-level progress from Spark's own
 * worker-based loader. Styled to match the existing error overlay
 * (same fixed/inset-0/bg-black-60 container) rather than introducing a
 * new visual pattern.
 *
 * lengthComputable can be false if the server didn't send a real
 * Content-Length (shouldn't happen for local files or the Hugging Face
 * CDN, but worth handling rather than showing a nonsense percentage) -
 * falls back to a plain "bytes loaded so far" readout with no percentage
 * or bar fill in that case.
 */
export const SplatLoadProgress = ({
  progress,
  indeterminateMessage,
}: SplatLoadProgressProps) => {
  // Was returning null the moment progress went falsy, before ever
  // checking indeterminateMessage - meaning that prop was declared but
  // structurally unreachable. This is the phase indeterminateMessage
  // exists for: progress (byte-level download tracking) is done and
  // cleared, but there's still real work happening with nothing
  // granular to measure.
  if (!progress && !indeterminateMessage) return null;

  if (!progress) {
    return (
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md rounded-lg bg-black/80 p-4 text-center text-white backdrop-blur">
          <h1 className="text-lg font-semibold md:text-xl">
            {indeterminateMessage}
          </h1>
        </div>
      </div>
    );
  }

  const percent =
    progress.lengthComputable && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-black/80 p-4 text-center text-white backdrop-blur">
        <h1 className="text-lg font-semibold md:text-xl">
          {percent !== null && percent < 100
            ? "Loading Splat"
            : "Processing Splat Data"}
        </h1>

        {percent !== null ? (
          <>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/70 transition-[width] duration-150"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-white/70">
              {percent}% — {formatBytes(progress.loaded)} /{" "}
              {formatBytes(progress.total)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-white/70">
            {formatBytes(progress.loaded)} loaded…
          </p>
        )}
      </div>
    </div>
  );
};
