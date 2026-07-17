type StaleMeasurementDataWarningProps = {
  onRefresh: () => void;
  isRefreshing: boolean;
};

/**
 * Surfaces what used to be a silent failure mode: transforming a loaded
 * splat (gizmo or the Transform Panel) never re-extracts splatCenters on
 * its own, so the geodesic graph and click-based annotation data quietly
 * keep pointing at pre-transform positions - producing a wrong-but-
 * plausible-looking measurement with no indication anything's off. This
 * doesn't fix the staleness itself (the "Refresh Measurement Data"
 * button already does that) - it makes the staleness impossible to miss,
 * regardless of whether the Transform Panel that button lives on is
 * even open at the time.
 */
export const StaleMeasurementDataWarning = ({
  onRefresh,
  isRefreshing,
}: StaleMeasurementDataWarningProps) => {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-amber-900/80 p-2 text-white backdrop-blur">
      <span className="text-xs">
        Measurement data is out of date — the splat has moved since it was last
        analyzed.
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="whitespace-nowrap rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50"
      >
        {isRefreshing ? "Refreshing…" : "Refresh Now"}
      </button>
    </div>
  );
};
