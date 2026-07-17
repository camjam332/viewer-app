import { useCallback, useRef, useState } from "react";

type FloaterCleanupPanelProps = {
  isAnalyzing: boolean;
  analysisReady: boolean;
  hiddenCount: number;
  totalCount: number;
  threshold: number;
  onAnalyze: () => void;
  onThresholdChange: (threshold: number) => void;
  onRevert: () => void;
  // Secondary control, deliberately separate from threshold: changing
  // this doesn't take effect live the way the threshold slider does - it
  // changes how the connectivity graph itself gets built, which means a
  // genuine re-run of the worker's k-d tree/union-find pass, not just a
  // cheap re-filter of already-computed numbers. Only takes effect the
  // next time Analyze/Re-analyze is actually clicked.
  connectivityMultiplier: number;
  onConnectivityMultiplierChange: (value: number) => void;
};

// The analysis (connected-component labeling via a k-d tree + Union-Find)
// is a real, expensive, one-time worker pass - but re-applying a
// threshold to already-computed component sizes is cheap. Still,
// "cheap" per-call isn't "free at 60 drag-events/sec" - debouncing the
// actual splat-mutation call means the slider only triggers a real
// update once the user pauses, while the number label itself stays
// instantly responsive (a separate, undebounced local state) so the
// control never feels laggy even though the underlying effect is
// deliberately delayed.
const DEBOUNCE_MS = 120;

export const FloaterCleanupPanel = ({
  isAnalyzing,
  analysisReady,
  hiddenCount,
  totalCount,
  threshold,
  onAnalyze,
  onThresholdChange,
  onRevert,
  connectivityMultiplier,
  onConnectivityMultiplierChange,
}: FloaterCleanupPanelProps) => {
  const [displayThreshold, setDisplayThreshold] = useState(threshold);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSliderChange = useCallback(
    (value: number) => {
      setDisplayThreshold(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onThresholdChange(value);
      }, DEBOUNCE_MS);
    },
    [onThresholdChange],
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-black/70 p-2 text-white backdrop-blur">
      <span className="text-sm font-medium text-heading">Floater Cleanup</span>

      {/* Undebounced and deliberately not tied to any live effect - this
          only takes effect the next time Analyze/Re-analyze is clicked,
          so there's nothing here that needs to be delayed. */}
      <label className="flex items-center justify-between gap-2 text-xs text-white/70">
        Connectivity sensitivity
        <input
          type="number"
          min={0.5}
          max={10}
          step={0.5}
          value={connectivityMultiplier}
          onChange={(e) => {
            const value = Number.parseFloat(e.target.value);
            if (!Number.isNaN(value)) onConnectivityMultiplierChange(value);
          }}
          className="w-16 rounded border border-white/20 bg-white/10 px-1 py-0.5 text-white"
        />
      </label>

      {!analysisReady ? (
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50"
        >
          {isAnalyzing ? "Analyzing…" : "Analyze for Floaters"}
        </button>
      ) : (
        <>
          <div className="flex gap-2">
            <button onClick={onRevert}>Reset</button>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50"
            >
              {isAnalyzing ? "Analyzing…" : "Re-analyze"}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={0.05}
            step={0.001}
            value={displayThreshold}
            onChange={(e) =>
              handleSliderChange(Number.parseFloat(e.target.value))
            }
            className="w-48"
          />
          <span className="text-xs text-white/70">
            Min cluster size: {(displayThreshold * 100).toFixed(1)}% —{" "}
            {hiddenCount.toLocaleString()} / {totalCount.toLocaleString()}{" "}
            splats hidden
          </span>
        </>
      )}
    </div>
  );
};
