import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
import type { ShapeType, TransformMode, MotionPath } from "../../App";
import { getShapeCircuitMaterial } from "../../lib/circuitStream";
import type { MotionController } from "../../lib/motionController";
import CustomShapeMesh from "./CustomShapeMesh";
import { SuspendedGlbShapeMesh } from "./GlbShapeMesh";
import AnimatedWrapper from "./AnimatedWrapper";
import ScaleGizmo from "./ScaleGizmo";
import RotationLabels from "./RotationLabels";
import PrimitiveGeometry from "./PrimitiveGeometry";
import ShapeMaterial from "./ShapeMaterial";
import { useLODGeometry } from "./LODShape";
import { sortMotorGroups } from "./utils/kinematicsUtils";

type KinematicNodeProps = {
  shape: ShapeType;
  shapes: ShapeType[];
  motorGroups: import("../../App").MotorGroup[];
  selectedIds: number[];
  mode: TransformMode;
  startScaleDrag: any;
  handleShapeDown: any;
  simulationFrame: any;
  gltfGeometryMap: any;
  evaluator: any;
  paths: any;
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>;
  setIsBusy: (busy: boolean) => void;
  savePathsToHistory: any;
  motionController: MotionController;
  wsSettings?: import("../../types/workspace").WorkspaceSettings;
  cogCouplings?: React.MutableRefObject<Map<number, number[]>>;
  updateBaseSize?: (id: number, baseSize: [number, number, number]) => void;
};

function KinematicNode({
  shape,
  shapes,
  motorGroups,
  selectedIds,
  mode,
  startScaleDrag,
  handleShapeDown,
  simulationFrame,
  gltfGeometryMap,
  evaluator,
  paths,
  meshRefs,
  setIsBusy,
  savePathsToHistory,
  motionController,
  wsSettings,
  cogCouplings,
  updateBaseSize,
}: KinematicNodeProps) {
  const isSelected = selectedIds.includes(shape.id);
  const path = paths.find((p: any) => p.id === shape.pathId);
  const simEx = simulationFrame;

  const axis = shape.jointAxis || "y";

  const jointGroupRef = useRef<THREE.Group>(null);
  const outerGroupRef = useRef<THREE.Group>(null);
  const scaleGroupRef = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (!jointGroupRef.current || !outerGroupRef.current) return;

    const dragRot = outerGroupRef.current.userData.activeDragRotation;
    if (dragRot) {
      if (shape.jointAxis === "xyz") {
        jointGroupRef.current.rotation.set(
          (dragRot.x * Math.PI) / 180,
          (dragRot.y * Math.PI) / 180,
          (dragRot.z * Math.PI) / 180
        );
      } else {
        const angle = shape.jointAxis === "x" ? dragRot.x : shape.jointAxis === "y" ? dragRot.y : dragRot.z;
        const angleRad = (angle * Math.PI) / 180;
        jointGroupRef.current.rotation.set(
          shape.jointAxis === "x" ? angleRad : 0,
          shape.jointAxis === "y" ? angleRad : 0,
          shape.jointAxis === "z" ? angleRad : 0
        );
      }
      jointGroupRef.current.position.set(0, 0, 0);
      jointGroupRef.current.scale.set(1, 1, 1);
      return;
    }

    const activeMGs = motorGroups.filter(mg => mg.shapeIds.includes(shape.id));

    if (activeMGs.length > 0) {
      const sortedMGs = sortMotorGroups(activeMGs);
      const mCompounded = new THREE.Matrix4();
      sortedMGs.forEach((mg) => {
        let pivot = new THREE.Vector3();
        if (mg.pivotShapeId !== undefined) {
          const pMesh = meshRefs.current?.get(mg.pivotShapeId);
          if (pMesh) {
            pMesh.getWorldPosition(pivot);
          } else {
            const ps = shapes.find((s) => s.id === mg.pivotShapeId);
            if (!ps) {
              // Neither a live mesh nor a shape record: the pivot shape was
              // deleted without its motor group being pruned. `pivot` is still
              // its constructed (0,0,0) at this point, so falling through
              // would rotate the whole group about the WORLD ORIGIN and fling
              // it across the scene. Skipping the group leaves the shape at
              // rest — visibly "this motor stopped working" rather than
              // silently wrong motion. See BUG-008.
              return;
            }
            pivot.set(...ps.position);
          }
        } else if (mg.pivot) {
          pivot.set(...mg.pivot);
        } else {
          const mMesh = meshRefs.current?.get(shape.id);
          if (mMesh) {
            mMesh.getWorldPosition(pivot);
          } else {
            pivot.set(...shape.position);
          }
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
                ((ms.values[0] || 0) * mul * Math.PI) / 180,
                ((ms.values[1] || 0) * mul * Math.PI) / 180,
                ((ms.values[2] || 0) * mul * Math.PI) / 180,
              );
            } else if (ms.type === "linear") {
              localPos.set(
                (ms.values[0] || 0) * mul,
                (ms.values[1] || 0) * mul,
                (ms.values[2] || 0) * mul,
              );
            }
          }
        }
        mLocal.compose(localPos, new THREE.Quaternion().setFromEuler(localRot), new THREE.Vector3(1, 1, 1));
        const mPivotInv = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);

        mMg.copy(mPivot).multiply(mLocal).multiply(mPivotInv);
        mCompounded.multiply(mMg);
      });

      outerGroupRef.current.updateMatrix();
      const mOuter = new THREE.Matrix4();
      if (outerGroupRef.current.parent) {
        outerGroupRef.current.parent.updateMatrixWorld(true);
        mOuter.copy(outerGroupRef.current.parent.matrixWorld).multiply(outerGroupRef.current.matrix);
      } else {
        mOuter.copy(outerGroupRef.current.matrix);
      }

      const mOuterInv = mOuter.clone().invert();
      const mJointLocal = mOuterInv.clone().multiply(mCompounded).multiply(mOuter);

      const localPos = new THREE.Vector3();
      const localQuat = new THREE.Quaternion();
      const localScale = new THREE.Vector3();
      mJointLocal.decompose(localPos, localQuat, localScale);

      jointGroupRef.current.position.copy(localPos);
      jointGroupRef.current.quaternion.copy(localQuat);
      jointGroupRef.current.scale.copy(localScale);
      return;
    }

    const linkedMotionChannelId = shape.motionChannelId || shape.circuitNodeId;
    if (linkedMotionChannelId) {
      const ms = motionController.getState(linkedMotionChannelId, delta);
      if (ms) {
        const mul = shape.motionInverted ? -1 : 1;
        const effectiveAxis = shape.jointAxis || axis;
        if (ms.type === "motor") {
          const angle = (ms.values[0] * mul * Math.PI) / 180;
          jointGroupRef.current.rotation.set(
            effectiveAxis === "x" ? angle : 0,
            effectiveAxis === "y" ? angle : 0,
            effectiveAxis === "z" ? angle : 0,
          );
          jointGroupRef.current.position.set(0, 0, 0);
        } else if (ms.type === "xyz_rotation") {
          jointGroupRef.current.rotation.set(
            ((ms.values[0] || 0) * mul * Math.PI) / 180,
            ((ms.values[1] || 0) * mul * Math.PI) / 180,
            ((ms.values[2] || 0) * mul * Math.PI) / 180,
          );
          jointGroupRef.current.position.set(0, 0, 0);
        } else if (ms.type === "linear") {
          jointGroupRef.current.position.set(
            (ms.values[0] || 0) * mul,
            (ms.values[1] || 0) * mul,
            (ms.values[2] || 0) * mul,
          );
          jointGroupRef.current.rotation.set(0, 0, 0);
        }
        jointGroupRef.current.scale.set(1, 1, 1);
        return;
      }
    }

    // Don't reset if this is a driven cog (coupled partner without a motor)
    const isDrivenCog = cogCouplings?.current?.has(shape.id) &&
      !motorGroups.some((mg) => mg.shapeIds.includes(shape.id)) &&
      !shape.motionChannelId;
    if (!isDrivenCog) {
      // Apply the manually-posed joint angle/rotation (set via the Rotate
      // panel) instead of always resetting to rest pose.
      if (shape.jointAxis === "xyz") {
        const jr = shape.jointRotation || [0, 0, 0];
        jointGroupRef.current.rotation.set(
          (jr[0] * Math.PI) / 180,
          (jr[1] * Math.PI) / 180,
          (jr[2] * Math.PI) / 180,
        );
      } else {
        const angleRad = ((shape.jointAngle || 0) * Math.PI) / 180;
        jointGroupRef.current.rotation.set(
          axis === "x" ? angleRad : 0,
          axis === "y" ? angleRad : 0,
          axis === "z" ? angleRad : 0,
        );
      }
      jointGroupRef.current.position.set(0, 0, 0);
      jointGroupRef.current.scale.set(1, 1, 1);
    }
  });

  // Propagate rotation from motor-driven cogwheels to their coupled partners
  useFrame((_state, _delta) => {
    if (!jointGroupRef.current || !cogCouplings) return;
    const hasMotor = motorGroups.some((mg) => mg.shapeIds.includes(shape.id)) || !!shape.motionChannelId;
    if (!hasMotor) return;
    const isCog = shape.type === "cogwheel" || shape.type.startsWith("cogwheel-");
    if (!isCog) return;
    const partners = cogCouplings.current?.get(shape.id);
    if (!partners || partners.length === 0) return;
    const jointRot = jointGroupRef.current.rotation;
    const euler = new THREE.Euler(-jointRot.x, -jointRot.y, -jointRot.z);
    partners.forEach((partnerId) => {
      const partnerObj = meshRefs.current?.get(partnerId);
      if (!partnerObj) return;
      const pJoint: THREE.Object3D | undefined = (partnerObj as any).userData?.jointGroup;
      if (!pJoint) return;
      pJoint.rotation.copy(euler);
      pJoint.position.set(0, 0, 0);
      pJoint.scale.set(1, 1, 1);
    });
  });

  const meshMat = (
    <ShapeMaterial shape={shape} simulationData={simEx} />
  );

  const meshBody = (
    <>
      <PrimitiveGeometry type={shape.type} />
      {meshMat}
      {isSelected && (
        <Edges color={shape.isLocked ? "#f43f5e" : "#4361ee"} />
      )}
    </>
  );

  const visualMesh =
    shape.type === "glb" && shape.url ? (
      <SuspendedGlbShapeMesh
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
        scale={[1, 1, 1]}
        onPointerDown={(e: any) => handleShapeDown(e, [shape])}
        shape={shape}
        isSelected={isSelected}
        simulationFrame={simulationFrame}
        userData={{ shapeId: shape.id }}
        onLoaded={(baseSize: [number, number, number]) =>
          updateBaseSize?.(shape.id, baseSize)
        }
      />
    ) : shape.type === "custom" && shape.customMembers ? (
      <CustomShapeMesh
        castShadow={!shape.isHole}
        receiveShadow={!shape.isHole}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
        scale={[1, 1, 1]}
        userData={{ shapeId: shape.id }}
        shape={shape}
        evaluator={evaluator}
        simulationFrame={simulationFrame}
        isSelected={isSelected}
        onPointerDown={(e: any) => handleShapeDown(e, [shape])}
        gltfGeometryMap={gltfGeometryMap}
        onLoaded={(baseSize: [number, number, number]) =>
          updateBaseSize?.(shape.id, baseSize)
        }
      />
    ) : (
      <mesh
        onPointerDown={(e) => handleShapeDown(e, [shape])}
        userData={{ shapeId: shape.id }}
        castShadow={!shape.isHole}
        receiveShadow={!shape.isHole}
      >
        {meshBody}
      </mesh>
    );

  const innerContent = (
    <group
      ref={(el) => {
        jointGroupRef.current = el;
        if (el && outerGroupRef.current) {
          outerGroupRef.current.userData.jointGroup = el;
        }
      }}
    >
      <group
        ref={(el) => {
          scaleGroupRef.current = el;
          if (outerGroupRef.current && el) {
            outerGroupRef.current.userData.scaleGroup = el;
          }
        }}
        scale={shape.scale}
      >
        {visualMesh}
      </group>
      {wsSettings?.showJointLabels !== false && motorGroups.some(mg => mg.pivotShapeId === shape.id) && (
        <RotationLabels shape={shape} meshRef={outerGroupRef as React.MutableRefObject<THREE.Object3D | null>} />
      )}
      {shape.isGripper && (
        <group
          name="gripPoint"
          ref={(el) => {
            if (el && outerGroupRef.current) {
              outerGroupRef.current.userData.gripPoint = el;
            }
          }}
          position={shape.gripOffset || [0, 0, 0]}
        >
          {shapes
            .filter((s) => s.grabbedBy === shape.id)
            .map((grabbedShape) => (
              <KinematicNode
                key={grabbedShape.id}
                shape={grabbedShape}
                shapes={shapes}
                motorGroups={motorGroups}
                selectedIds={selectedIds}
                mode={mode}
                startScaleDrag={startScaleDrag}
                handleShapeDown={handleShapeDown}
                simulationFrame={simulationFrame}
                gltfGeometryMap={gltfGeometryMap}
                evaluator={evaluator}
                paths={paths}
                meshRefs={meshRefs}
                setIsBusy={setIsBusy}
                savePathsToHistory={savePathsToHistory}
                motionController={motionController}
                wsSettings={wsSettings}
                cogCouplings={cogCouplings}
              />
            ))}
        </group>
      )}
    </group>
  );

  const scaleGizmo = isSelected &&
    selectedIds.length === 1 &&
    !shape.isLocked &&
    mode === "scale" && (
      <ScaleGizmo
        key={`sgizmo-${shape.id}`}
        shape={shape}
        meshRef={outerGroupRef}
        startScaleDrag={startScaleDrag}
        wsSettings={wsSettings}
      />
    );

  // `grabbedBy` is the authoritative, render-safe signal for "this shape is
  // being held" — GrabbingSystem sets it on the shape itself, and it is what
  // the gripper's own JSX filters on to decide what to nest.
  //
  // This used to read outerGroupRef.current.parent/.position/.rotation during
  // render instead. A ref holds the PREVIOUS commit's value and does not
  // trigger a re-render when it changes, so a grabbed shape rendered one frame
  // behind its own transform — and 13 of the codebase's 20 react-hooks/refs
  // errors pointed at exactly these lines. While grabbed the shape is parented
  // under the gripper's gripPoint group, whose transform already places it, so
  // the local offset is simply zero. See BUG-047.
  const isGrabbed = shape.grabbedBy !== undefined;
  // When following a path, AnimatedWrapper's own group already supplies the
  // absolute position/orientation along the curve — applying shape.position
  // and shape.rotation here too would double up the offset. A grabbed shape is
  // positioned by its holder's gripPoint for the same reason.
  const zero: [number, number, number] = [0, 0, 0];
  const groupPos = path || isGrabbed ? zero : shape.position;
  const groupRot = path || isGrabbed ? zero : shape.rotation;

  const mainGroup = (
    <group
      ref={(el) => {
        if (el) {
          meshRefs.current.set(shape.id, el);
          outerGroupRef.current = el as THREE.Group;
          if (scaleGroupRef.current) {
            el.userData.scaleGroup = scaleGroupRef.current;
          }
          if (jointGroupRef.current) {
            el.userData.jointGroup = jointGroupRef.current;
          }
        }
      }}
      position={groupPos}
      rotation={groupRot}
      scale={[1, 1, 1]}
      userData={{ shapeId: shape.id }}
    >
      <>
        {innerContent}
        {scaleGizmo}
      </>
    </group>
  );

  return path ? (
    <AnimatedWrapper key={`aw-${shape.id}`} shape={shape} path={path}>
      {mainGroup}
    </AnimatedWrapper>
  ) : (
    mainGroup
  );
}

// Exported for measurement/tests only: React.memo calls this once per
// memoized instance and re-renders that instance when it returns false, so
// counting its false-returns across a scene's nodes for a given prop
// transition is exactly the re-render count a Profiler would show.
export function areKinematicNodePropsEqual(
  a: Record<string, any>,
  b: Record<string, any>,
): boolean {
  const aShape = a.shape;
  const bShape = b.shape;
  if (aShape.id !== bShape.id) return false;
  if (aShape.position.join(",") !== bShape.position.join(",")) return false;
  if (aShape.rotation.join(",") !== bShape.rotation.join(",")) return false;
  if (aShape.scale.join(",") !== bShape.scale.join(",")) return false;
  if (aShape.color !== bShape.color) return false;
  if (aShape.type !== bShape.type) return false;
  if (aShape.url !== bShape.url) return false;
  if (aShape.parentId !== bShape.parentId) return false;
  if (aShape.isHole !== bShape.isHole) return false;
  if (aShape.isLocked !== bShape.isLocked) return false;
  if (aShape.pathId !== bShape.pathId) return false;
  if (aShape.jointAxis !== bShape.jointAxis) return false;
  if (aShape.jointAngle !== bShape.jointAngle) return false;
  if (aShape.motionChannelId !== bShape.motionChannelId) return false;
  if (aShape.jointParentId !== bShape.jointParentId) return false;
  if (aShape.circuitNodeId !== bShape.circuitNodeId) return false;
  // Fields the comparator used to omit, so a change to any of them did not
  // re-render this node. It was saved only by the `a.shapes !== b.shapes`
  // check below firing on essentially every state update — which made the
  // memo simultaneously incorrect and nearly pointless. See BUG-049.
  if (aShape.grabbedBy !== bShape.grabbedBy) return false;
  if (aShape.isGripper !== bShape.isGripper) return false;
  if ((aShape.gripOffset ?? []).join(",") !== (bShape.gripOffset ?? []).join(",")) return false;
  if ((aShape.jointRotation ?? []).join(",") !== (bShape.jointRotation ?? []).join(",")) return false;
  if (aShape.motionInverted !== bShape.motionInverted) return false;
  if (aShape.mass !== bShape.mass) return false;
  if ((aShape.baseSize ?? []).join(",") !== (bShape.baseSize ?? []).join(",")) return false;
  if (aShape.customMembers !== bShape.customMembers) return false;

  // simulationFrame changes identity on every streamed frame. A shape drives a
  // circuit glow ONLY when it has a circuitNodeId — getShapeCircuitMaterial()
  // returns no emissive otherwise — so a shape without one has nothing to
  // re-render for when a frame arrives. Scope the check to circuit-linked
  // shapes; the rest stop re-rendering ~30-60x/sec during a live stream.
  // (circuitNodeId itself is compared above, so gaining/losing one still
  // forces a render and re-arms this.)
  if (
    (aShape.circuitNodeId || bShape.circuitNodeId) &&
    a.simulationFrame !== b.simulationFrame
  ) {
    return false;
  }

  // `shapes` array identity changes on every setShapes (every drag commit,
  // every field edit), so `a.shapes !== b.shapes` re-rendered EVERY node on
  // EVERY edit — the per-field checks above were dead code behind it (BUG-049
  // noted this). This node only derives one thing from the full list in its
  // render: a gripper's set of grabbed children. Compare just that slice.
  // (The line ~113 useFrame also reads `shapes` as a fallback when a motor
  // pivot's mesh is unmounted — a rare path that tolerates one stale render
  // cycle; it already skips a genuinely-missing pivot.)
  if (aShape.isGripper || bShape.isGripper) {
    const grabbedSig = (list: any[], gripperId: number) =>
      list
        .filter((s) => s.grabbedBy === gripperId)
        .map((s) => s.id)
        .sort((x, y) => x - y)
        .join(",");
    if (
      grabbedSig(a.shapes ?? [], aShape.id) !==
      grabbedSig(b.shapes ?? [], bShape.id)
    ) {
      return false;
    }
  }

  // motorGroups identity changes only on motor add/edit/delete + undo — not
  // per-drag, not per-frame — so this blunt check is not a hot path, and
  // scoping it risks missing a field the animation useFrame reads.
  if (a.motorGroups !== b.motorGroups) return false;
  if (a.selectedIds?.includes(aShape.id) !== b.selectedIds?.includes(bShape.id)) return false;
  if (a.mode !== b.mode) return false;
  if (a.wsSettings?.showJointLabels !== b.wsSettings?.showJointLabels) return false;
  return true;
}

export default React.memo(KinematicNode, areKinematicNodePropsEqual);
