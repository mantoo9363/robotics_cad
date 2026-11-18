/**
 * GrabbingSystem.ts — Pure contact-based grab
 *
 * ALL gripper shapes touching a grabbable box → GRAB
 * ANY gripper stops touching                  → RELEASE
 *
 * Uses getOwnBoundingBox() with BFS traversal that STOPS at child-shape
 * boundaries (groups with a different shapeId). Three.js traverse() can't
 * skip subtrees, so we use manual BFS instead.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ShapeType } from "../../../App";

/** Surface-to-surface tolerance */
const GRAB_RADIUS = 0;

/** Color while held */
const GRABBED_COLOR = "#00e5ff";

/** Debug logging interval (frames). 0 = off */
const DEBUG_EVERY_N_FRAMES = 120;

export function useGrabbingSystem(
  shapes: ShapeType[],
  setShapes: React.Dispatch<React.SetStateAction<ShapeType[]>>,
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>
) {
  const shapesRef = useRef<ShapeType[]>(shapes);
  useEffect(() => { shapesRef.current = shapes; });

  const originalColorsRef = useRef<Map<number, string>>(new Map());
  const lastGrabStateRef  = useRef<Map<number, number | null>>(new Map());
  const frameCountRef     = useRef(0);

  useFrame(() => {
    const shapes = shapesRef.current;
    frameCountRef.current++;
    const shouldLog = DEBUG_EVERY_N_FRAMES > 0 && frameCountRef.current % DEBUG_EVERY_N_FRAMES === 0;

    const grippers: ShapeType[]   = [];
    const candidates: ShapeType[] = [];

    for (const s of shapes) {
      if (s.isGripper)  grippers.push(s);
      if (s.grabbable && !s.isGripper) candidates.push(s);
    }

    if (shouldLog) {
      console.log(`[Grab] grippers=${grippers.length} candidates=${candidates.length}`);
    }

    if (grippers.length === 0 || candidates.length === 0) {
      releaseAllHeld(shapes, meshRefs, originalColorsRef, lastGrabStateRef, setShapes);
      return;
    }

    // Scope contact requirements per assembly (robot) instead of scene-wide,
    // so two unrelated grippers merely touching the same object from
    // different sides can't jointly satisfy the "2 contacts" grab threshold.
    const shapesById = new Map(shapes.map((s) => [s.id, s]));
    const gripperAssembly = new Map<number, number>();
    for (const g of grippers) {
      gripperAssembly.set(g.id, getAssemblyRootId(g, shapesById));
    }
    const assemblySizes = new Map<number, number>();
    for (const assemblyId of gripperAssembly.values()) {
      assemblySizes.set(assemblyId, (assemblySizes.get(assemblyId) || 0) + 1);
    }

    const pendingUpdates = new Map<number, Partial<ShapeType>>();

    for (const cand of candidates) {
      const candObj = meshRefs.current.get(cand.id);
      if (!candObj) continue;

      candObj.updateMatrixWorld(true);
      const candBox = getOwnBoundingBox(candObj, cand.id);

      if (shouldLog) {
        const cs = new THREE.Vector3(); candBox.getSize(cs);
        const cc = new THREE.Vector3(); candBox.getCenter(cc);
        console.log(`[Grab] box ${cand.id}: center=(${fv(cc)}) size=(${fs(cs)})`);
      }

      const wasGrabbed = cand.grabbedBy !== undefined;
      const holdingGripper = wasGrabbed ? grippers.find((g) => g.id === cand.grabbedBy) : undefined;
      const holdingAssembly = holdingGripper ? gripperAssembly.get(holdingGripper.id) : undefined;

      let touchingCountOthers = 0; // within the holding gripper's assembly only
      const touchingByAssembly = new Map<number, { grip: ShapeType; gap: number }[]>();

      for (const grip of grippers) {
        const gripObj = meshRefs.current.get(grip.id);
        if (!gripObj) continue;

         gripObj.updateMatrixWorld(true);
        const gripBox  = getOwnBoundingBox(gripObj, grip.id);
        const expanded = gripBox.clone().expandByScalar(GRAB_RADIUS);
        const touches  = expanded.intersectsBox(candBox);
        const gap      = boxSurfaceGap(gripBox, candBox);

        if (shouldLog) {
          const gs = new THREE.Vector3(); gripBox.getSize(gs);
          const gc = new THREE.Vector3(); gripBox.getCenter(gc);
          console.log(
            `[Grab]   jaw ${grip.id}: center=(${fv(gc)}) size=(${fs(gs)}) gap=${gap.toFixed(2)} ${touches ? "✅" : "❌"}`
          );
        }

        if (touches) {
          const assemblyId = gripperAssembly.get(grip.id)!;
          const arr = touchingByAssembly.get(assemblyId) ?? [];
          arr.push({ grip, gap });
          touchingByAssembly.set(assemblyId, arr);
          if (wasGrabbed && assemblyId === holdingAssembly && grip.id !== cand.grabbedBy) {
            touchingCountOthers++;
          }
        }
      }

      const lastState  = lastGrabStateRef.current.get(cand.id);

      // When already grabbed, the box is parented to the grabber's gripPoint,
      // so that gripper's bbox always overlaps the box.  For release detection
      // we only count OTHER grippers within the SAME assembly as the holder —
      // an unrelated gripper elsewhere in the scene must not keep this held.
      let isTouchingEnough: boolean;
      let winningAssembly: number | null = null;
      if (wasGrabbed) {
        if (!holdingGripper || holdingAssembly === undefined) {
          isTouchingEnough = false;
        } else {
          const holdingAssemblySize = assemblySizes.get(holdingAssembly) || 1;
          const requiredOthers = Math.min(Math.max(1, Math.min(2, holdingAssemblySize) - 1), holdingAssemblySize - 1);
          isTouchingEnough = touchingCountOthers >= requiredOthers;
        }
      } else {
        for (const [assemblyId, touchers] of touchingByAssembly) {
          const requiredContacts = Math.min(2, assemblySizes.get(assemblyId) || touchers.length);
          if (touchers.length >= requiredContacts) {
            winningAssembly = assemblyId;
            break;
          }
        }
        isTouchingEnough = winningAssembly !== null;
      }

      // ── GRAB ────────────────────────────────────────────────────────────
      if (isTouchingEnough && !wasGrabbed) {
        if (lastState !== undefined && lastState !== null) continue;

        const winningTouchers = winningAssembly !== null ? touchingByAssembly.get(winningAssembly) : undefined;
        const gripperToUse =
          winningTouchers?.reduce((best, cur) => (cur.gap < best.gap ? cur : best))?.grip ??
          grippers[0];
        const gripperObj   = meshRefs.current.get(gripperToUse.id);
        if (!gripperObj) continue;
        gripperObj.updateMatrixWorld(true);

        const gripPoint: THREE.Object3D | null =
          (gripperObj.userData.gripPoint as THREE.Object3D | undefined) ??
          gripperObj.getObjectByName("gripPoint") ?? null;

        const bwp = new THREE.Vector3();
        const bwq = new THREE.Quaternion();
        candObj.getWorldPosition(bwp);
        candObj.getWorldQuaternion(bwq);

        let snapPos: [number, number, number] = [bwp.x, bwp.y, bwp.z];
        let snapRot: [number, number, number] = [0, 0, 0];

        if (gripPoint) {
          gripPoint.updateMatrixWorld(true);
          const lp = bwp.clone();
          gripPoint.worldToLocal(lp);
          snapPos = [lp.x, lp.y, lp.z];
          const gpq = new THREE.Quaternion();
          gripPoint.getWorldQuaternion(gpq);
          const rel = new THREE.Euler().setFromQuaternion(gpq.clone().invert().multiply(bwq));
          snapRot = [rel.x, rel.y, rel.z];
        } else {
          const lp = bwp.clone();
          gripperObj.worldToLocal(lp);
          snapPos = [lp.x, lp.y, lp.z];
        }

        if (cand.color) originalColorsRef.current.set(cand.id, cand.color);
        lastGrabStateRef.current.set(cand.id, gripperToUse.id);
        console.info(`[Grab] 🔒 jaw(s) of assembly ${winningAssembly} touching → grabbed shape ${cand.id}`);

        pendingUpdates.set(cand.id, {
          grabbedBy: gripperToUse.id,
          position:  snapPos,
          rotation:  snapRot,
          color:     GRABBED_COLOR,
        });

      // ── RELEASE ─────────────────────────────────────────────────────────
      } else if (!isTouchingEnough && wasGrabbed) {
        if (lastState === null) continue;

        const origColor = originalColorsRef.current.get(cand.id);
        originalColorsRef.current.delete(cand.id);
        lastGrabStateRef.current.set(cand.id, null);
        console.info(`[Grab] 📤 Jaw(s) separated → released shape ${cand.id}`);

        const heldObj = meshRefs.current.get(cand.id);
        if (heldObj) {
          heldObj.updateMatrixWorld(true);
          const wp = new THREE.Vector3();
          const wq = new THREE.Quaternion();
          heldObj.getWorldPosition(wp);
          heldObj.getWorldQuaternion(wq);
          const wr = new THREE.Euler().setFromQuaternion(wq);
          pendingUpdates.set(cand.id, {
            grabbedBy: undefined,
            position:  [wp.x, wp.y, wp.z],
            rotation:  [wr.x, wr.y, wr.z],
            ...(origColor !== undefined && { color: origColor }),
          });
        } else {
          pendingUpdates.set(cand.id, {
            grabbedBy: undefined,
            ...(origColor !== undefined && { color: origColor }),
          });
        }

      } else if (isTouchingEnough && wasGrabbed) {
        lastGrabStateRef.current.set(cand.id, cand.grabbedBy ?? null);
      } else {
        lastGrabStateRef.current.delete(cand.id);
      }
    }

    // ── Orphan cleanup ──────────────────────────────────────────────────
    shapes.forEach((s) => {
      if (s.grabbedBy === undefined) return;
      if (pendingUpdates.has(s.id))  return;

      const gripper = shapes.find((g) => g.id === s.grabbedBy);
      const isStillCandidate = s.grabbable && !s.isGripper;
      
      if (gripper?.isGripper && isStillCandidate) {
        return; // Main loop already handled its contact logic, keeping it grabbed
      }

      const origColor = originalColorsRef.current.get(s.id);
      originalColorsRef.current.delete(s.id);
      lastGrabStateRef.current.delete(s.id);

      const obj = meshRefs.current.get(s.id);
      if (obj) {
        obj.updateMatrixWorld(true);
        const wp = new THREE.Vector3();
        const wq = new THREE.Quaternion();
        obj.getWorldPosition(wp);
        obj.getWorldQuaternion(wq);
        const wr = new THREE.Euler().setFromQuaternion(wq);
        pendingUpdates.set(s.id, {
          grabbedBy: undefined,
          position:  [wp.x, wp.y, wp.z],
          rotation:  [wr.x, wr.y, wr.z],
          ...(origColor !== undefined && { color: origColor }),
        });
      } else {
        pendingUpdates.set(s.id, {
          grabbedBy: undefined,
          ...(origColor !== undefined && { color: origColor }),
        });
      }
    });

    if (pendingUpdates.size > 0) {
      setShapes((prev) =>
        prev.map((s) => {
          const upd = pendingUpdates.get(s.id);
          return upd ? { ...s, ...upd } : s;
        })
      );
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// getOwnBoundingBox — BFS traversal that STOPS at child-shape boundaries.
//
// Three.js traverse() always visits ALL descendants — you can't skip subtrees.
// This BFS manually controls which children to recurse into, skipping any
// group whose userData.shapeId is a DIFFERENT shape (i.e. a kinematic child).
// ═══════════════════════════════════════════════════════════════════════════════
function getOwnBoundingBox(root: THREE.Object3D, shapeId: number): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);

  const queue: THREE.Object3D[] = [root];

  while (queue.length > 0) {
    const node = queue.shift()!;

    // If this node is a Mesh, include its geometry
    if ((node as THREE.Mesh).isMesh && (node as THREE.Mesh).geometry) {
      const mesh = node as THREE.Mesh;
      const geom = mesh.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      if (geom.boundingBox) {
        const meshBox = geom.boundingBox.clone();
        meshBox.applyMatrix4(mesh.matrixWorld);
        box.union(meshBox);
      }
    }

    // Enqueue children — but SKIP any child that starts a different shape's subtree
    for (const child of node.children) {
      // A child group with a different shapeId = kinematic child shape → skip entirely
      if (
        child !== root &&
        child.userData?.shapeId !== undefined &&
        child.userData.shapeId !== shapeId
      ) {
        continue; // don't recurse into this child's subtree
      }
      queue.push(child);
    }
  }

  // Fallback: if no own meshes found, use position as a tiny box
  if (box.isEmpty()) {
    const pos = new THREE.Vector3();
    root.getWorldPosition(pos);
    box.expandByPoint(pos);
    box.expandByScalar(0.1);
  }

  return box;
}

// ── Release all ─────────────────────────────────────────────────────────────
function releaseAllHeld(
  shapes: ShapeType[],
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>,
  originalColorsRef: React.MutableRefObject<Map<number, string>>,
  lastGrabStateRef: React.MutableRefObject<Map<number, number | null>>,
  setShapes: React.Dispatch<React.SetStateAction<ShapeType[]>>
) {
  const held = shapes.filter((s) => s.grabbedBy !== undefined);
  if (held.length === 0) return;

  const updates = new Map<number, Partial<ShapeType>>();
  for (const s of held) {
    const origColor = originalColorsRef.current.get(s.id);
    originalColorsRef.current.delete(s.id);
    lastGrabStateRef.current.delete(s.id);

    const obj = meshRefs.current.get(s.id);
    if (obj) {
      obj.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      obj.getWorldPosition(wp);
      obj.getWorldQuaternion(wq);
      const wr = new THREE.Euler().setFromQuaternion(wq);
      updates.set(s.id, {
        grabbedBy: undefined,
        position:  [wp.x, wp.y, wp.z],
        rotation:  [wr.x, wr.y, wr.z],
        ...(origColor !== undefined && { color: origColor }),
      });
    } else {
      updates.set(s.id, {
        grabbedBy: undefined,
        ...(origColor !== undefined && { color: origColor }),
      });
    }
  }

  if (updates.size > 0) {
    setShapes((prev) =>
      prev.map((s) => {
        const upd = updates.get(s.id);
        return upd ? { ...s, ...upd } : s;
      })
    );
  }
}

// ── Assembly grouping ─────────────────────────────────────────────────────────
// Walks a gripper up its kinematic (jointParentId) chain, then its group
// (parentId) chain, to find the root shape of the robot/assembly it belongs
// to. Two grippers only count toward the same "N contacts to grab" threshold
// if they resolve to the same root.
function getAssemblyRootId(shape: ShapeType, byId: Map<number, ShapeType>): number {
  let current = shape;
  const seen = new Set<number>([shape.id]);

  while (current.jointParentId !== undefined) {
    const parent = byId.get(current.jointParentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }

  while (current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }

  return current.id;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function boxSurfaceGap(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function fv(v: THREE.Vector3) { return `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`; }
function fs(v: THREE.Vector3) { return `${v.x.toFixed(1)}×${v.y.toFixed(1)}×${v.z.toFixed(1)}`; }
