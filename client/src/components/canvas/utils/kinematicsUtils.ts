import * as THREE from "three";
import type { ShapeType } from "../../../App";
import type { MotionController } from "../../../lib/motionController";

type MotorGroupT = import("../../../App").MotorGroup;

/**
 * Orders motor groups parent-before-child, so a compounded transform applies
 * an outer joint before the inner one it carries.
 *
 * Implemented as a topological sort rather than `Array.prototype.sort`. The
 * previous version passed a comparator that encoded two independent partial
 * relations (pivot dependency, subset containment) and returned 0 otherwise,
 * which is not a valid total order — it is not transitive, so with three or
 * more interacting groups the result was implementation-defined and a chain
 * could compose in the wrong order. A dependency graph is what the data
 * actually is, so this builds that instead of approximating it. See BUG-007.
 *
 * Cycles (A parents B parents A — malformed, but reachable from hand-edited
 * state) are broken deterministically by emitting the remaining groups in
 * input order rather than looping or dropping them.
 */
export function sortMotorGroups(activeMGs: MotorGroupT[]): MotorGroupT[] {
  const n = activeMGs.length;
  if (n < 2) return [...activeMGs];

  // parentOf[i] = set of indices that must come BEFORE i.
  const isParent = (a: MotorGroupT, b: MotorGroupT): boolean => {
    // a is b's parent if b pivots on a shape that a controls...
    if (b.pivotShapeId !== undefined && a.shapeIds.includes(b.pivotShapeId)) return true;
    // ...or if a strictly contains b's shape set.
    const aContainsB = b.shapeIds.every((id) => a.shapeIds.includes(id));
    const bContainsA = a.shapeIds.every((id) => b.shapeIds.includes(id));
    return aContainsB && !bContainsA;
  };

  const indegree = new Array<number>(n).fill(0);
  const children: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (isParent(activeMGs[i], activeMGs[j])) {
        children[i].push(j);
        indegree[j]++;
      }
    }
  }

  // Kahn's algorithm, seeded and drained in input order so the output is
  // stable for groups with no relation between them.
  const out: MotorGroupT[] = [];
  const emitted = new Array<boolean>(n).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);

  while (queue.length > 0) {
    const i = queue.shift()!;
    if (emitted[i]) continue;
    emitted[i] = true;
    out.push(activeMGs[i]);
    for (const c of children[i]) {
      if (--indegree[c] === 0) queue.push(c);
    }
  }

  // Anything left is part of a cycle. Append in input order — deterministic,
  // and never silently drops a group the caller expects to be driven.
  for (let i = 0; i < n; i++) if (!emitted[i]) out.push(activeMGs[i]);

  return out;
}

export function getJointWorldTransform(
  shape: ShapeType,
  shapes: ShapeType[],
  motionController: MotionController,
  time: number,
  delta: number,
  motorGroups: import("../../../App").MotorGroup[]
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  let localPos = new THREE.Vector3(...shape.position);
  let localQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...shape.rotation));

  if (shape.jointParentId !== undefined) {
    const parentShape = shapes.find((s) => s.id === shape.jointParentId);
    if (parentShape) {
      const parentJointGroupMatrix = getJointGroupWorldMatrix(parentShape, shapes, motionController, time, delta, motorGroups);
      const childLocalMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...shape.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...shape.rotation)),
        new THREE.Vector3(1, 1, 1)
      );
      const childWorldMatrix = parentJointGroupMatrix.clone().multiply(childLocalMatrix);
      const wPos = new THREE.Vector3();
      const wQuat = new THREE.Quaternion();
      const wScale = new THREE.Vector3();
      childWorldMatrix.decompose(wPos, wQuat, wScale);
      return { position: wPos, quaternion: wQuat };
    }
  }
  return { position: localPos, quaternion: localQuat };
}

export function getJointGroupWorldMatrix(
  shape: ShapeType,
  shapes: ShapeType[],
  motionController: MotionController,
  time: number,
  delta: number,
  motorGroups: import("../../../App").MotorGroup[]
): THREE.Matrix4 {
  const outerW = getJointWorldTransform(shape, shapes, motionController, time, delta, motorGroups);
  const mOuter = new THREE.Matrix4().compose(
    outerW.position,
    outerW.quaternion,
    new THREE.Vector3(1, 1, 1)
  );

  const activeMGs = motorGroups.filter(mg => mg.shapeIds.includes(shape.id));

  if (activeMGs.length > 0) {
    const sortedMGs = sortMotorGroups(activeMGs);
    const mCompounded = new THREE.Matrix4();
    sortedMGs.forEach((mg) => {
      let pivot = new THREE.Vector3();
      if (mg.pivotShapeId !== undefined) {
        const ps = shapes.find((s) => s.id === mg.pivotShapeId);
        if (ps) pivot.set(...ps.position);
      } else if (mg.pivot) {
        pivot.set(...mg.pivot);
      } else {
        pivot.set(...shape.position);
      }

      const mMg = new THREE.Matrix4();
      const mPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);

      const mLocal = new THREE.Matrix4();
      let localRot = new THREE.Euler(0, 0, 0);
      let localPos = new THREE.Vector3(0, 0, 0);

      if (mg.motionChannelId) {
        const ms = motionController.getState(mg.motionChannelId, delta);
        if (ms) {
          const mul = mg.motionInverted ? -1 : 1;
          const effectiveAxis = mg.jointAxis || "y";
          if (ms.type === "motor") {
            let val = ms.values[0];
            val = Math.max(-720, Math.min(720, val));
            if (mg.minLimit !== undefined) val = Math.max(mg.minLimit, val);
            if (mg.maxLimit !== undefined) val = Math.min(mg.maxLimit, val);
            const angle = (val * mul * Math.PI) / 180;
            localRot.set(
              effectiveAxis === "x" ? angle : 0,
              effectiveAxis === "y" ? angle : 0,
              effectiveAxis === "z" ? angle : 0,
            );
          } else if (ms.type === "xyz_rotation") {
            localRot.set(
              ((Math.max(-720, Math.min(720, ms.values[0] || 0))) * mul * Math.PI) / 180,
              ((Math.max(-720, Math.min(720, ms.values[1] || 0))) * mul * Math.PI) / 180,
              ((Math.max(-720, Math.min(720, ms.values[2] || 0))) * mul * Math.PI) / 180
            );
          } else if (ms.type === "linear") {
            localPos.set(
              Math.max(-100, Math.min(100, (ms.values[0] || 0) * mul)),
              Math.max(-100, Math.min(100, (ms.values[1] || 0) * mul)),
              Math.max(-100, Math.min(100, (ms.values[2] || 0) * mul)),
            );
          }
        }
      }
      mLocal.compose(localPos, new THREE.Quaternion().setFromEuler(localRot), new THREE.Vector3(1, 1, 1));
      const mPivotInv = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);

      mMg.copy(mPivot).multiply(mLocal).multiply(mPivotInv);
      mCompounded.multiply(mMg);
    });

    return mCompounded.multiply(mOuter);
  }

  // Get motion settings from shape
  const motionChannelId = shape.motionChannelId;
  const motionInverted = shape.motionInverted;
  const pivot = shape.jointPivot ?? [0, 0, 0];

  const axis = shape.jointAxis ?? "y";
  const angleRad = ((shape.jointAngle ?? 0) * Math.PI) / 180;

  let jointRot = new THREE.Euler(0, 0, 0);
  let jointPos = new THREE.Vector3(0, 0, 0);

  if (motionChannelId) {
    const ms = motionController.getState(motionChannelId, delta);
    if (ms) {
      const mul = motionInverted ? -1 : 1;
      if (ms.type === "motor") {
        const clampedValue = Math.max(-720, Math.min(720, ms.values[0]));
        const angle = (clampedValue * mul * Math.PI) / 180;
        jointRot.set(
          axis === "x" ? angle : 0,
          axis === "y" ? angle : 0,
          axis === "z" ? angle : 0
        );
      } else if (ms.type === "xyz_rotation") {
        jointRot.set(
          ((Math.max(-720, Math.min(720, ms.values[0] || 0))) * mul * Math.PI) / 180,
          ((Math.max(-720, Math.min(720, ms.values[1] || 0))) * mul * Math.PI) / 180,
          ((Math.max(-720, Math.min(720, ms.values[2] || 0))) * mul * Math.PI) / 180
        );
      } else if (ms.type === "linear") {
        jointPos.set(
          Math.max(-100, Math.min(100, (ms.values[0] || 0) * mul)),
          Math.max(-100, Math.min(100, (ms.values[1] || 0) * mul)),
          Math.max(-100, Math.min(100, (ms.values[2] || 0) * mul))
        );
      }
    } else {
      if (shape.isJointAnimated) {
        const oscAngleRad = Math.sin(time * 2.5) * ((60 * Math.PI) / 180);
        jointRot.set(
          axis === "x" ? oscAngleRad : 0,
          axis === "y" ? oscAngleRad : 0,
          axis === "z" ? oscAngleRad : 0
        );
      } else {
        if (axis === "xyz") {
          const jr = shape.jointRotation || [0, 0, 0];
          jointRot.set(
            (jr[0] * Math.PI) / 180,
            (jr[1] * Math.PI) / 180,
            (jr[2] * Math.PI) / 180
          );
        } else {
          jointRot.set(
            axis === "x" ? angleRad : 0,
            axis === "y" ? angleRad : 0,
            axis === "z" ? angleRad : 0
          );
        }
      }
    }
  } else {
    if (shape.isJointAnimated) {
      const oscAngleRad = Math.sin(time * 2.5) * ((60 * Math.PI) / 180);
      jointRot.set(
        axis === "x" ? oscAngleRad : 0,
        axis === "y" ? oscAngleRad : 0,
        axis === "z" ? oscAngleRad : 0
      );
    } else {
      if (axis === "xyz") {
        const jr = shape.jointRotation || [0, 0, 0];
        jointRot.set(
          (jr[0] * Math.PI) / 180,
          (jr[1] * Math.PI) / 180,
          (jr[2] * Math.PI) / 180
        );
      } else {
        jointRot.set(
          axis === "x" ? angleRad : 0,
          axis === "y" ? angleRad : 0,
          axis === "z" ? angleRad : 0
        );
      }
    }
  }

  const mJoint = new THREE.Matrix4()
    .makeTranslation(pivot[0], pivot[1], pivot[2])
    .multiply(new THREE.Matrix4().makeRotationFromEuler(jointRot))
    .multiply(new THREE.Matrix4().makeTranslation(jointPos.x, jointPos.y, jointPos.z));

  return mOuter.multiply(mJoint);
}
