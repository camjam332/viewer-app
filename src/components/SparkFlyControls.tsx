import { useThree, useFrame } from "@react-three/fiber";
import { SparkControls } from "@sparkjsdev/spark";
import { useEffect, useMemo } from "react";

// SparkControls' constructor permanently attaches document-level keyboard
// listeners and canvas-level pointer listeners with no dispose method (see
// @sparkjsdev/spark's controls.d.ts) - so unlike drei's <FlyControls>, this
// instance can't be recreated every time fly mode toggles on/off without
// leaking duplicate listeners. It's kept mounted for the Canvas's whole
// lifetime instead, gated by `active` rather than by conditional mounting.
//
// Chosen over drei's <FlyControls> specifically for its drag-to-look feel:
// SparkControls' PointerControls rotates the camera by the pointer's
// frame-to-frame movement delta while a button is held (orbit-style, only
// turns while the cursor is actually moving), whereas three.js's FlyControls
// drives rotation off the held cursor's offset from the click point, causing
// continuous spin for as long as the button stays down.
export function SparkFlyControls({ active }: { active: boolean }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const set = useThree((s) => s.set);

  const controls = useMemo(
    () => new SparkControls({ canvas: gl.domElement }),
    [gl],
  );

  useEffect(() => {
    controls.fpsMovement.enable = active;
    controls.pointerControls.enable = active;
    if (!active) return;
    // PointerControls' pointerdown/move/up listeners are attached once at
    // construction and keep recording drag position into `rotating`/
    // `sliding` regardless of `enable` - that flag only gates .update(),
    // not the raw event handlers. So any drag made with CameraControls
    // while fly mode was inactive (e.g. orbiting) still gets silently
    // tracked here, with `.last` frozen at wherever the drag started (it
    // only advances inside .update(), which was never called). Without
    // this reset, the first .update() after re-activating would compute
    // one huge delta - the entire accumulated drag distance - as a sudden
    // jump.
    const pc = controls.pointerControls;
    pc.rotating = null;
    pc.sliding = null;
    pc.lastDown = null;
    pc.lastUp = null;
    pc.lastLastUp = null;
    pc.moveVelocity.set(0, 0, 0);
    pc.rotateVelocity.set(0, 0, 0);
    pc.scroll.set(0, 0, 0);
    controls.fpsMovement.keydown = {};
    controls.fpsMovement.keycode = {};
    // SparkControls.update() derives deltaTime from its own `lastTime`,
    // only advanced when .update() actually runs - which we skip entirely
    // while inactive. Left alone, the first call after reactivating would
    // see a deltaTime spanning the whole real-world time fly mode was off
    // (could be minutes), and if a movement key happened to be held right
    // then, FpsMovement would apply moveSpeed * that huge deltaTime and
    // teleport the camera. Resetting to 0 makes SparkControls.update()
    // treat this next call as the first ever (see its `this.lastTime ||
    // time` fallback), giving deltaTime = 0 for it instead.
    controls.lastTime = 0;
  }, [active, controls]);

  useEffect(() => {
    if (!active) return;
    const old = get().controls;
    // @ts-expect-error - R3F's `controls` slot is typed for objects with
    // addEventListener/removeEventListener; SparkControls has neither, same
    // as drei's own FlyControls wrapper which suppresses this identically.
    set({ controls });
    return () => set({ controls: old });
  }, [active, controls, get, set]);

  useFrame(() => {
    if (!active) return;
    controls.update(camera);
  });

  return null;
}
