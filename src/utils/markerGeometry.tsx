import { SphereGeometry } from "three";

// Shared by every annotation/measurement marker so a fresh SphereGeometry
// (default 32x16 segments) doesn't get constructed for each point on every
// render of its list - geometry only defines vertex shape, so one instance
// is safe to reuse across any number of differently colored/scaled meshes.
export const MARKER_SPHERE_GEOMETRY = new SphereGeometry();
