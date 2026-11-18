import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ShapeType, GroupType } from "../../App";
import type { MotionController } from "../../lib/motionController";
import { sortMotorGroups } from "./utils/kinematicsUtils";

type JointMotionGroupProps = {
  group: GroupType;
  fallbackRotation: [number, number, number];
  motionController: MotionController;
  shapes: ShapeType[];
  groups: GroupType[];
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>;
  children: React.ReactNode;
};

export default function JointMotionGroup({
  group,
  fallbackRotation,
  motionController,
  shapes,
  groups,
  meshRefs,
  children,
}: JointMotionGroupProps) {
  const ref = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (!ref.current) return;

    // Save previous state to roll back in case of collision
    const prevRot = ref.current.rotation.clone();
    const prevPos = ref.current.position.clone();

    const motion =
      group.motionChannelId
        ? motionController.getState(
          group.motionChannelId,
          delta,
        )
        : null;

    if (!motion) {
      ref.current.position.set(0, 0, 0);
      ref.current.rotation.set(
        fallbackRotation[0],
        fallbackRotation[1],
        fallbackRotation[2],
      );
    } else if (motion.type === "linear") {
      ref.current.position.set(
        motion.values[0] || 0,
        motion.values[1] || 0,
        motion.values[2] || 0,
      );
      ref.current.rotation.set(0, 0, 0);
    } else {
      ref.current.position.set(0, 0, 0);
      if (motion.type === "xyz_rotation") {
        ref.current.rotation.set(
          THREE.MathUtils.degToRad(motion.values[0] || 0),
          THREE.MathUtils.degToRad(motion.values[1] || 0),
          THREE.MathUtils.degToRad(motion.values[2] || 0),
        );
      } else {
        const angle = THREE.MathUtils.degToRad(motion.values[0] || 0);
        const axis = group.jointAxis || "y";
        ref.current.rotation.set(
          axis === "x" ? angle : 0,
          axis === "y" ? angle : 0,
          axis === "z" ? angle : 0,
        );
      }
    }

    // Collision check
    ref.current.updateMatrixWorld(true);
    const movingBox = new THREE.Box3().setFromObject(ref.current);

    // Gather descendant shape IDs
    const descendantGroupIds = [group.id];
    const getDescendantGroups = (parentId: number) => {
      groups.forEach((gr) => {
        if (gr.parentGroupId === parentId && !descendantGroupIds.includes(gr.id)) {
          descendantGroupIds.push(gr.id);
          getDescendantGroups(gr.id);
        }
      });
    };
    getDescendantGroups(group.id);

    const descendantShapeIds = shapes
      .filter((s) => s.parentId && descendantGroupIds.includes(s.parentId))
      .map((s) => s.id);

    const getDescendantShapes = (parentId: number) => {
      shapes.forEach((s) => {
        if (s.jointParentId === parentId && !descendantShapeIds.includes(s.id)) {
          descendantShapeIds.push(s.id);
          getDescendantShapes(s.id);
        }
      });
    };
    const initialDescendantShapeIds = [...descendantShapeIds];
    initialDescendantShapeIds.forEach((id) => getDescendantShapes(id));

    const lockedShapes = shapes.filter(
      (s) => s.isLocked && !s.isHole && !descendantShapeIds.includes(s.id)
    );

    let hasCollision = false;
    for (const lockedShape of lockedShapes) {
      const lockedObj = meshRefs.current.get(lockedShape.id);
      if (lockedObj) {
        const lockedBox = new THREE.Box3().setFromObject(lockedObj);

        // Shrink bounding boxes slightly
        const epsilon = 0.01;
        lockedBox.expandByScalar(-epsilon);
        movingBox.expandByScalar(-epsilon);

        if (movingBox.intersectsBox(lockedBox)) {
          hasCollision = true;
          break;
        }
      }
    }

    if (hasCollision) {
      // Rollback rotation and position
      ref.current.rotation.copy(prevRot);
      ref.current.position.copy(prevPos);
      ref.current.updateMatrixWorld(true);
    }
  });

  return (
    <group ref={ref} rotation={fallbackRotation}>
      {children}
    </group>
  );
}
