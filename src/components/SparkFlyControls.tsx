import { useThree, useFrame } from "@react-three/fiber";
import { SparkControls } from "@sparkjsdev/spark";
import { useEffect, useMemo, useRef } from "react";
import { useViewer } from "../state/state";

// How many consecutive non-moving frames to wait before declaring the
// camera settled - roughly 160ms at 60fps. See the useFrame comment below
// for why this exists at all.
const SETTLE_FRAMES = 10;

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
  const setIsCameraMoving = useViewer((s) => s.setIsCameraMoving);

  const controls = useMemo(
    () => new SparkControls({ canvas: gl.domElement }),
    [gl],
  );
  // Hysteresis state for the isCameraMoving debounce in useFrame below -
  // refs, not state, since they're written every frame and must never
  // themselves trigger a re-render.
  const wasMovingRef = useRef(false);
  const settledFramesRef = useRef(0);

  useEffect(() => {
    controls.fpsMovement.enable = active;
    controls.pointerControls.enable = active;
    if (!active) {
      // useFrame below skips calling controls.update() entirely while
      // inactive, so nothing would otherwise clear a stale `true` left
      // over from whatever motion was happening the instant fly mode
      // was switched off. Resetting the hysteresis refs alongside it -
      // otherwise wasMovingRef could still read true on reactivation
      // (nothing clears it just by deactivating), and useFrame's
      // `if (!wasMovingRef.current)` guard would then skip re-announcing
      // movement, leaving the store stuck at false even once real motion
      // resumes.
      wasMovingRef.current = false;
      settledFramesRef.current = 0;
      setIsCameraMoving(false);
      return;
    }
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
    // Clamp the raw accumulated wheel delta before SparkControls consumes
    // it. Unlike fpsMovement (WASD), which is speed-capped via an
    // exponential-decay velocity model (moveInertia), pointerControls'
    // wheel handler just does `this.scroll.add(new Vector3(deltaX, deltaY,
    // deltaZ))` on every native `wheel` event with no cap, and update()
    // applies the full accumulated vector as a single, instant,
    // undamped position add. A fast scroll/fling gesture can fire many
    // wheel events before the next animation frame, so that accumulated
    // vector can be large enough to jump the camera right up against
    // (or through) dense splat geometry in one frame - splat overdraw
    // cost scales sharply with proximity, which is what actually shows
    // up as dropped frames. Clamping here caps how far a single frame's
    // worth of scroll can move the camera without touching Spark's own
    // per-event accumulation or removing scroll-zoom's responsiveness -
    // sustained scrolling still covers distance every frame, just at a
    // bounded max rate instead of an unbounded burst.
    const MAX_SCROLL_PER_FRAME = 120;
    const scroll = controls.pointerControls.scroll;
    if (scroll.length() > MAX_SCROLL_PER_FRAME) {
      scroll.setLength(MAX_SCROLL_PER_FRAME);
    }
    // update() returns whether anything actually moved/rotated this frame -
    // the same isCameraMoving flag CameraActivityBridge drives from
    // CameraControls' wake/rest/sleep events in orbit mode, feeding the
    // same App.tsx effect that disables SplatMesh.raycastable while the
    // camera is in motion (a real per-splat WASM cost otherwise triggered
    // by every wheel/pointer event React-three-fiber raycasts for).
    //
    // Debounced, not set directly from `moving` every frame - unlike
    // CameraControls' wake/rest (which fire once each at gesture start/
    // end), this per-frame flag is threshold-based on instantaneous
    // velocity/scroll and can flip true/false rapidly within a single
    // continuous scroll gesture (scroll itself is zeroed every frame in
    // PointerControls.update()). App.tsx reads isCameraMoving reactively
    // at the top of the whole component, so every flip was forcing a full
    // React re-render - confirmed via trace as a new, real cost (heavy
    // commitMutationEffectsOnFiber/renderRootSync presence) competing with
    // the very raycast cost this was meant to avoid. Only calling
    // setIsCameraMoving on an actual sustained transition - immediately on
    // the first moving frame, but only after SETTLE_FRAMES consecutive
    // non-moving frames for the reverse - keeps this an occasional,
    // gesture-scoped update instead of a per-frame one.
    const moving = controls.update(camera);
    if (moving) {
      settledFramesRef.current = 0;
      if (!wasMovingRef.current) {
        wasMovingRef.current = true;
        setIsCameraMoving(true);
      }
    } else if (wasMovingRef.current) {
      settledFramesRef.current += 1;
      if (settledFramesRef.current >= SETTLE_FRAMES) {
        wasMovingRef.current = false;
        setIsCameraMoving(false);
      }
    }
  });

  return null;
}
