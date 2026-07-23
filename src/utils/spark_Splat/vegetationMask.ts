import { dyno } from "@sparkjsdev/spark";

/**
 * Splat selection based on how vegetation-like a splat's current color
 * looks. Uses the excess-green index (2*g - r - b) rather than distance to
 * one fixed target color - grass swings from deep shadow-green to bright
 * highlight-green, so a single target+distance either misses the shadowed
 * patches or has to loosen enough to start catching non-green subjects
 * too. Excess-green is a relative measure (green-dominance over red/blue),
 * so it stays stable across that lighting range instead of anchoring to
 * one absolute color. `threshold` is the minimum excess-green value to
 * count as a match - higher excludes more borderline/desaturated greens.
 * `invert` flips the mask - e.g. select everything EXCEPT vegetation (the
 * cat, not the grass) instead of vegetation itself.
 */
export type SparkVegetationSelector = {
  threshold: number;
  invert?: boolean;
};

/**
 * Builds the vegetation mask as its own reusable piece, so any modifier
 * that wants to gate an effect on this selection (e.g. breatheModifier.ts)
 * shares the exact same excess-green formula rather than a re-derived copy
 * of it.
 */
export function buildSparkVegetationMask(
  { r, g, b }: { r: dyno.DynoVal<"float">; g: dyno.DynoVal<"float">; b: dyno.DynoVal<"float"> },
  selector: SparkVegetationSelector,
): dyno.DynoVal<"bool"> {
  const mask = dyno.greaterThan(
    dyno.sub(dyno.mul(g, dyno.dynoConst("float", 2)), dyno.add(r, b)),
    dyno.dynoConst("float", selector.threshold),
  );
  return selector.invert ? dyno.not(mask) : mask;
}
