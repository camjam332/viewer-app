// Plain mutable holder for the extracted splat-centers Float32Array used
// to build Measurement's geodesic graph - deliberately NOT React
// state/props. React's dev-mode "Components" DevTools-track instrumentation
// walks every rendered component's props recursively (a for-in loop, see
// react-three-fiber's bundled Dl/ct helpers), and Object.prototype.toString
// on a typed array returns "Float32Array", not "Array", so it never hits
// that serializer's array fast-path - a multi-million-element Float32Array
// reachable from ANY component's props (even nested inside a plain object
// or a ref) gets walked index-by-index, which measured as a multi-second
// main-thread stall for a scene the size of stump.spz. Keeping the actual
// buffer here, outside the fiber tree entirely, means it's never reachable
// from a props walk no matter how deeply nested. Consumers read it via
// getSplatCentersForGraph(); a separate, tiny primitive "version" counter
// (safe to pass as an actual prop/state, since primitives short-circuit
// that serializer) is what actually triggers re-reads.
let current: Float32Array | null = null;

export function getSplatCentersForGraph(): Float32Array | null {
  return current;
}

export function setSplatCentersForGraph(value: Float32Array | null): void {
  current = value;
}
