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
};

// The analysis (k-NN density scoring) is a real, expensive, one-time
// worker pass - but re-applying a threshold to already-computed scores
// is cheap. Still, "cheap" per-call isn't "free at 60 drag-events/sec" -
// debouncing the actual splat-mutation call means the slider only
// triggers a real update once the user pauses, while the number label
// itself stays instantly responsive (a separate, undebounced local
// state) so the control never feels laggy even though the underlying
// effect is deliberately delayed.
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
          <button onClick={onRevert}>Reset</button>
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={displayThreshold}
            onChange={(e) =>
              handleSliderChange(Number.parseFloat(e.target.value))
            }
            className="w-48"
          />
          <span className="text-xs text-white/70">
            Threshold: {displayThreshold.toFixed(1)} —{" "}
            {hiddenCount.toLocaleString()} / {totalCount.toLocaleString()}{" "}
            splats hidden
          </span>
        </>
      )}
    </div>
  );
};
