type Axis = 0 | 1 | 2;
const AXIS_LABELS: ["X", "Y", "Z"] = ["X", "Y", "Z"];

type SplatTransformPanelProps = {
  position: [number, number, number];
  rotationDeg: [number, number, number];
  onPositionChange: (axis: Axis, value: number) => void;
  onRotationChange: (axis: Axis, degrees: number) => void;
};

/**
 * Numeric complement to the TransformControls gizmo, not a replacement -
 * the gizmo is better for rough/visual adjustment, this is better for
 * exact values and for seeing at a glance what detectOrientationFromSamples
 * actually produced. Plain number inputs rather than sliders: position is
 * unbounded (no natural min/max to size a slider to), and rotation values
 * accumulated from repeated adjustments can exceed a naive -180..180
 * range - a slider that silently wraps or clamps would be more confusing
 * here than a plain field that shows exactly what's stored.
 *
 * Read-only display value comes from the parent (App.tsx owns the actual
 * splat ref and does the reading/writing) - this component only renders
 * fields and forwards edits, it doesn't touch the Object3D itself.
 */
export const SplatTransformPanel = ({
  position,
  rotationDeg,
  onPositionChange,
  onRotationChange,
}: SplatTransformPanelProps) => {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-black/70 p-2 text-white backdrop-blur">
      <span className="text-sm font-medium text-heading">Splat Transform</span>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/70">Position</span>
        <div className="flex gap-1">
          {AXIS_LABELS.map((label, axis) => (
            <label key={label} className="flex items-center gap-1 text-xs">
              {label}
              <input
                type="number"
                step={0.01}
                value={Number(position[axis].toFixed(3))}
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value);
                  if (Number.isNaN(value)) return;
                  onPositionChange(axis as Axis, value);
                }}
                className="w-20 rounded border border-white/20 bg-white/10 px-1 py-0.5 text-white"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/70">Rotation (°)</span>
        <div className="flex gap-1">
          {AXIS_LABELS.map((label, axis) => (
            <label key={label} className="flex items-center gap-1 text-xs">
              {label}
              <input
                type="number"
                step={1}
                value={Number(rotationDeg[axis].toFixed(1))}
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value);
                  if (Number.isNaN(value)) return;
                  onRotationChange(axis as Axis, value);
                }}
                className="w-20 rounded border border-white/20 bg-white/10 px-1 py-0.5 text-white"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};
