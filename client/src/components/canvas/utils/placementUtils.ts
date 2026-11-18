import * as THREE from "three";
import { getPrimitiveBaseSize } from "../../../lib/shapeDimensions";

// addShape / addGlbShape always spawn new shapes at this uniform scale.
export const SPAWN_SCALE = 10;

export function getShapeHalfHeight(type: string): number {
  return (getPrimitiveBaseSize(type)[1] * SPAWN_SCALE) / 2;
}

export function getGlbHalfHeight(normalizedHeight: number): number {
  return (normalizedHeight * SPAWN_SCALE) / 2;
}

// Real half-height of a loaded GLB scene once normalized to fit the same
// unit cube every GLB is spawned at (see wrapper/scaleFactor math in
// GhostPreview.tsx's GlbGhostMesh and GlbShapeMesh.tsx). Flat models (a
// cogwheel, a SimLab gear) have a true half-height far below
// SPAWN_SCALE / 2 — using that constant as a stand-in for every GLB drop is
// what leaves flat models floating at a height sized for a cube-shaped
// model instead of their own.
export function getLoadedGlbHalfHeight(scene: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const sf = maxDim > 0 ? 1 / maxDim : 1;
  return getGlbHalfHeight(size.y * sf);
}

function isRealHit(intersection: THREE.Intersection): boolean {
  let obj: THREE.Object3D | null = intersection.object;
  while (obj) {
    if (obj.userData?.isPlacementPreview || obj.userData?.isHelper) return false;
    obj = obj.parent;
  }
  return true;
}

// Raycasts against the scene and returns where an object of the given
// half-height should sit: on top of whatever surface was hit (offset along
// the hit's world-space normal), or on the ground plane as a fallback.
export function computeDropTransform(
  raycaster: THREE.Raycaster,
  scene: THREE.Object3D,
  halfHeight: number,
): { pos: [number, number, number]; rot: [number, number, number] } {
  const intersects = raycaster.intersectObjects(scene.children, true);
  const valid = intersects.find(isRealHit);

  if (valid && valid.normal) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(valid.object.matrixWorld);
    const worldNormal = valid.normal.clone().applyMatrix3(normalMatrix).normalize();
    const point = valid.point.clone().addScaledVector(worldNormal, halfHeight);
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, worldNormal);
    const euler = new THREE.Euler().setFromQuaternion(quat);
    return { pos: [point.x, point.y, point.z], rot: [euler.x, euler.y, euler.z] };
  }

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const target = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, target)) {
    return { pos: [target.x, target.y + halfHeight, target.z], rot: [0, 0, 0] };
  }
  return { pos: [0, halfHeight, 0], rot: [0, 0, 0] };
}
