import * as THREE from "three";
import { getCogWheelGeometry } from "../components/canvas/utils/geometryHelpers";

const cache = new Map<string, THREE.BufferGeometry>();

// Exported so the physics collider builder can derive its ring-wedge
// decomposition from the exact same radii the render mesh uses.
export const TORUS_MAJOR_RADIUS = 0.4;
export const TORUS_MINOR_RADIUS = 0.15;

function getOrCreate(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (!cache.has(key)) {
    cache.set(key, factory());
  }
  return cache.get(key)!;
}

export function getCachedGeometry(type?: string, detail?: "high" | "medium" | "low"): THREE.BufferGeometry {
  const detailSuffix = detail === "high" ? "-h" : detail === "low" ? "-l" : "";
  const key = `${type || "sphere"}${detailSuffix}`;
  const segs = detail === "high" ? 32 : detail === "low" ? 8 : 16;
  switch (type) {
    case "cube":
      return getOrCreate("cube", () => new THREE.BoxGeometry(1, 1, 1));
    case "cylinder":
      return getOrCreate(key, () => new THREE.CylinderGeometry(0.5, 0.5, 1, segs));
    case "cone":
      return getOrCreate(key, () => new THREE.ConeGeometry(0.5, 1, segs));
    case "torus":
      return getOrCreate(key, () => new THREE.TorusGeometry(TORUS_MAJOR_RADIUS, TORUS_MINOR_RADIUS, Math.max(8, segs / 2), Math.max(16, segs * 2)));
    case "hexagon":
      return getOrCreate("hexagon", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
    case "cogwheel":
      return getOrCreate("cogwheel", () => getCogWheelGeometry(8));
    case "cogwheel-6t":
      return getOrCreate("cogwheel-6t", () => getCogWheelGeometry(6));
    case "cogwheel-8t":
      return getOrCreate("cogwheel-8t", () => getCogWheelGeometry(8));
    case "cogwheel-12t":
      return getOrCreate("cogwheel-12t", () => getCogWheelGeometry(12));
    case "cogwheel-16t":
      return getOrCreate("cogwheel-16t", () => getCogWheelGeometry(16));
    case "sphere":
    default:
      return getOrCreate(key, () => new THREE.SphereGeometry(0.5, segs, segs));
  }
}

export function clearGeometryCache(): void {
  cache.forEach((geom) => geom.dispose());
  cache.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", clearGeometryCache);
}
