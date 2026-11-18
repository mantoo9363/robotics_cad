import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CuboidCollider } from "@react-three/rapier";
import { useVoxelCollider } from "../../lib/useVoxelCollider";
import type { VoxelInput } from "../../lib/hollowShapeVoxelization";

type VoxelCompoundCollidersProps = {
  voxelInput: VoxelInput | null;
  mass: number;
  friction: number;
  restitution: number;
  keyPrefix: string;
  // Rendered while voxelization hasn't resolved yet (or resolved to nothing/
  // failed), and whenever voxelInput itself is null (member isn't concave
  // enough to need this at all) — the existing hull/cuboid collider this
  // component exists to upgrade past, kept as a safety net rather than
  // leaving the body with no collider (falls through the floor) or a
  // silently wrong one forever.
  fallback: React.ReactNode;
  // Composed onto each voxel box's own local center/orientation. Needed
  // when this collider set lives inside a shared group RigidBody at a
  // per-member offset rather than owning the RigidBody itself — a
  // standalone shape's body position already IS the shape's placement (no
  // offset needed there), but a group member's boxes are in that member's
  // own local frame and have to be placed at its offset within the group,
  // same as its sibling PrimitiveColliders already are.
  parentPosition?: [number, number, number];
  parentRotation?: [number, number, number];
};

/**
 * Shared voxel-compound-collider renderer for anything that isn't its own
 * standalone RigidBody (VoxelizedShapeBody owns that case) — a member inside
 * a non-boolean group, or a CSG group's boolean result mesh. Same
 * worker-backed voxelization as VoxelizedShapeBody, just collider-only:
 * the caller already owns the RigidBody, this only decides what to render
 * inside it while the async result is (or isn't yet) available.
 */
export default function VoxelCompoundColliders({
  voxelInput,
  mass,
  friction,
  restitution,
  keyPrefix,
  fallback,
  parentPosition,
  parentRotation,
}: VoxelCompoundCollidersProps) {
  const { compute, boxes, loading } = useVoxelCollider();

  useEffect(() => {
    if (!voxelInput) return;
    compute(voxelInput.cacheKey, voxelInput.positions, voxelInput.indices, voxelInput.featureRegions);
  }, [voxelInput, compute]);

  const ready = !loading && boxes !== null && boxes.length > 0;

  const totalVolume = useMemo(() => {
    if (!boxes || boxes.length === 0) return 0;
    return boxes.reduce((sum, b) => sum + b.volume, 0) || 1;
  }, [boxes]);

  const qParent = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(...(parentRotation ?? [0, 0, 0]))),
    [parentRotation],
  );
  const vParentPos = useMemo(
    () => new THREE.Vector3(...(parentPosition ?? [0, 0, 0])),
    [parentPosition],
  );

  if (!voxelInput || !ready) return <>{fallback}</>;

  return (
    <>
      {boxes!.map((b, idx) => {
        const center = new THREE.Vector3(...b.center)
          .applyQuaternion(qParent)
          .add(vParentPos);
        return (
          <CuboidCollider
            key={`${keyPrefix}-voxel-${idx}`}
            args={b.halfExtents}
            position={[center.x, center.y, center.z]}
            rotation={parentRotation ?? [0, 0, 0]}
            mass={mass * (b.volume / totalVolume)}
            friction={friction}
            restitution={restitution}
          />
        );
      })}
    </>
  );
}
