import { dyno, type GsplatModifier, type SplatMesh } from "@sparkjsdev/spark";
import {
  buildSparkVegetationMask,
  type SparkVegetationSelector,
} from "./vegetationMask";

/**
 * amplitude/noiseAmplitude are in the splat's local units. speed is
 * radians of phase per second - higher moves faster, shared between the
 * Y breathe and the X/Z noise so they stay roughly in tempo with each
 * other.
 */
export type SparkBreatheOptions = {
  amplitude: number;
  speed: number;
  noiseAmplitude: number;
};

/**
 * Builds the displaced center on its own, split out of
 * createSparkBreatheModifier so other modifiers could reuse the exact same
 * motion instead of duplicating - and risking drifting from - this
 * formula.
 *
 * Y moves in sync with a single global sine wave (breathing in/out) -
 * `y += amplitude * sin(time * speed)` uses the same phase for every
 * splat, so the whole selection moves up and down together.
 *
 * X/Z get a per-splat noise wobble instead: `hashVec3(index)` is a
 * deterministic pseudo-random vec3 seeded from the splat's own index
 * (same trick Spark's built-in snow generator uses for its "wander"
 * motion), and its x/y components become a phase OFFSET added to the
 * shared clock for each axis. That offset is what makes it noise rather
 * than a second synchronized breathe - each splat wobbles out of phase
 * with its neighbors instead of all moving together.
 */
export function buildSparkBreatheDisplacement(
  {
    center,
    index,
    time,
  }: {
    center: dyno.DynoVal<"vec3">;
    index: dyno.DynoVal<"int">;
    time: dyno.DynoVal<"float">;
  },
  { amplitude, speed, noiseAmplitude }: SparkBreatheOptions,
): dyno.DynoVal<"vec3"> {
  const { x, y, z } = dyno.split(center).outputs;
  const phase = dyno.mul(time, dyno.dynoConst("float", speed));

  const breathedY = dyno.add(
    y,
    dyno.mul(dyno.sin(phase), dyno.dynoConst("float", amplitude)),
  );

  const seed = dyno.hashVec3(index); // components in [0, 1)
  const { x: seedX, y: seedY } = dyno.split(seed).outputs;
  const twoPi = dyno.dynoConst("float", Math.PI * 2);
  const dynoNoiseAmplitude = dyno.dynoConst("float", noiseAmplitude);

  const noisedX = dyno.add(
    x,
    dyno.mul(
      dyno.sin(dyno.add(phase, dyno.mul(seedX, twoPi))),
      dynoNoiseAmplitude,
    ),
  );
  const noisedZ = dyno.add(
    z,
    dyno.mul(
      dyno.sin(dyno.add(phase, dyno.mul(seedY, twoPi))),
      dynoNoiseAmplitude,
    ),
  );

  return dyno.combine({ vector: center, x: noisedX, y: breathedY, z: noisedZ });
}

/**
 * Builds (but doesn't attach) a modifier applying buildSparkBreatheDisplacement
 * to selected splats. Meant to run in object space (objectModifier). Pass
 * `selector` to restrict the motion to vegetation-colored splats (see
 * SparkVegetationSelector); omit it to animate every splat.
 */
export const createSparkBreatheModifier = (
  splats: SplatMesh,
  options: SparkBreatheOptions,
  selector?: SparkVegetationSelector,
): GsplatModifier => {
  const { time } = splats.context;

  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      if (!gsplat) throw new Error("No gsplat input");

      const { r, g, b, index, center } = dyno.splitGsplat(gsplat).outputs;
      const breathedCenter = buildSparkBreatheDisplacement(
        { center, index, time },
        options,
      );

      // No selector - every splat animates, same as before. With one,
      // splats outside the mask keep their original center.
      const displacedCenter = selector
        ? dyno.select(
            buildSparkVegetationMask({ r, g, b }, selector),
            breathedCenter,
            center,
          )
        : breathedCenter;

      gsplat = dyno.combineGsplat({ gsplat, center: displacedCenter });

      return { gsplat };
    },
  );
};
