import { Canvas } from "@react-three/fiber";
import type {
  ShapeType,
  TransformMode,
  CustomMember,
  MotionPath,
  GroupType,
} from "../App";
import type { CircuitStreamFrame } from "../lib/circuitStream";
import type { MotionController } from "../lib/motionController";
import React, { useState, useMemo, useRef, useCallback, Suspense } from "react";
import * as THREE from "three";
import RotationControlPanel from "./canvas/RotationControlPanel";
import CsgGeometryLoader from "./canvas/CsgGeometryLoader";
import DropPlacement, { type PendingDrop, type DropPayload } from "./canvas/DropPlacement";
import GhostPreview from "./canvas/GhostPreview";
import Scene from "./canvas/Scene";
import type { WorkspaceSettings } from "../types/workspace";
import ViewportControls from "./canvas/ViewportControls";
import ErrorBoundary from "./ErrorBoundary";

type Props = {
  shapes: ShapeType[];
  groups: GroupType[];
  motorGroups: import("../App").MotorGroup[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  selectedIds: number[];
  setShapes: React.Dispatch<React.SetStateAction<ShapeType[]>>;
  mode: TransformMode;
  snapToGrid: boolean;
  snapIncrement: number;
  gridSize: number;
  paths: MotionPath[];
  setPaths: React.Dispatch<React.SetStateAction<MotionPath[]>>;
  selectedPathId: number | null;
  setSelectedPathId?: (id: number | null) => void;
  selectedPathIds?: number[];
  wsSettings: WorkspaceSettings;
  setWsSettings: React.Dispatch<React.SetStateAction<WorkspaceSettings>>;
  showPaths: boolean;
  drawingAltitude: number;
  activePathWP: number | null;
  setActivePathWP: React.Dispatch<React.SetStateAction<number | null>>;
  savePathsToHistory: (
    newShapes?: ShapeType[],
    newPaths?: MotionPath[],
  ) => void;
  simulationFrame: CircuitStreamFrame | null;
  brushSize?: number;
  brushShape?: "sphere" | "cube";
  scaleFromSide?: boolean;
  motionController: MotionController;
  addShape: (
    type: string,
    pos?: [number, number, number],
    rot?: [number, number, number],
  ) => void;
  addGlbShape: (url: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
  placementRequest: DropPayload | null;
  setPlacementRequest: React.Dispatch<React.SetStateAction<DropPayload | null>>;
  loadDemoCar?: () => void;
  meshRefs?: React.MutableRefObject<Map<number, THREE.Object3D>>;
};

export default function Canvas3D(props: Props) {
  const { shapes, wsSettings, meshRefs } = props;
  const localMeshRefs = useRef(new Map<number, THREE.Object3D>());
  const refs = meshRefs ?? localMeshRefs;
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  // Set by the in-Canvas error boundary below. That boundary can't render DOM
  // (it lives inside <Canvas>, where a <div> would crash the renderer), so it
  // reports up to here and this component draws the notice outside the Canvas.
  const [sceneError, setSceneError] = useState<string | null>(null);

  const bounds = useMemo(() => {
    const width = wsSettings?.presetWidth || 223;
    const length = wsSettings?.presetLength || 223;
    const halfX = width / 2;
    const halfZ = length / 2;
    const maxY = Math.max(width, length) / 2;
    return {
      minX: -halfX + 0.5,
      maxX: halfX - 0.5,
      minY: 0.01,
      maxY: maxY - 0.5,
      minZ: -halfZ + 0.5,
      maxZ: halfZ - 0.5,
    };
  }, [wsSettings]);

  // Drag ref to remember starting shapes state during active drag
  const rotationDragRef = useRef<{
    startShapes: ShapeType[];
    groupCenter: THREE.Vector3;
  } | null>(null);

  const initRotationDrag = () => {
    if (rotationDragRef.current) return;

    // Compute bounding box and center of selected shapes
    const box = new THREE.Box3();
    let count = 0;
    props.selectedIds.forEach((id) => {
      const obj = refs.current.get(id);
      if (obj) {
        box.expandByObject(obj);
        count++;
      }
    });

    const groupCenter = new THREE.Vector3();
    if (count > 0) {
      box.getCenter(groupCenter);
    }

    rotationDragRef.current = {
      startShapes: props.shapes,
      groupCenter,
    };
  };

  const applyRotationUpdate = (nextX: number, nextY: number, nextZ: number) => {
    if (!rotationDragRef.current) return;
    const { startShapes, groupCenter } = rotationDragRef.current;

    if (props.selectedIds.length === 1) {
      const targetId = props.selectedIds[0];
      const startS = startShapes.find((x) => x.id === targetId);
      if (!startS) return;

      const obj = refs.current.get(targetId);
      if (!obj) return;

      if (startS.jointParentId !== undefined) {
        // Child joint node
        obj.userData.activeDragRotation = { x: nextX, y: nextY, z: nextZ };
      } else {
        // Standard shape or root kinematic
        const radX = (nextX * Math.PI) / 180;
        const radY = (nextY * Math.PI) / 180;
        const radZ = (nextZ * Math.PI) / 180;

        // Temporarily apply rotation and starting position to THREE.js object to calculate Y offset
        obj.rotation.set(radX, radY, radZ);

        // Position should start from the start position
        const parent = obj.parent;
        const startPosVec = new THREE.Vector3(
          startS.position[0],
          startS.position[1],
          startS.position[2],
        );
        if (parent) {
          obj.position.copy(parent.worldToLocal(startPosVec.clone()));
        } else {
          obj.position.copy(startPosVec);
        }
        obj.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(obj);
        let newY = startS.position[1];
        if (box.min.y < bounds.minY) {
          newY += bounds.minY - box.min.y;
        }

        // Apply final rotation and position directly to the THREE.js object
        obj.rotation.set(radX, radY, radZ);
        const finalPosVec = new THREE.Vector3(
          startS.position[0],
          newY,
          startS.position[2],
        );
        if (parent) {
          obj.position.copy(parent.worldToLocal(finalPosVec));
        } else {
          obj.position.copy(finalPosVec);
        }
        obj.updateMatrixWorld(true);
      }
    } else {
      // Multiple shapes (Group rotation)
      const radDX = (nextX * Math.PI) / 180;
      const radDY = (nextY * Math.PI) / 180;
      const radDZ = (nextZ * Math.PI) / 180;

      const m1 = new THREE.Matrix4().makeTranslation(
        -groupCenter.x,
        -groupCenter.y,
        -groupCenter.z,
      );
      const euler = new THREE.Euler(radDX, radDY, radDZ, "XYZ");
      const mRot = new THREE.Matrix4().makeRotationFromEuler(euler);
      const m2 = new THREE.Matrix4().makeTranslation(
        groupCenter.x,
        groupCenter.y,
        groupCenter.z,
      );
      const mTransform = m2.multiply(mRot).multiply(m1);

      const deltaQuat = new THREE.Quaternion().setFromEuler(euler);

      const tempPositions = new Map<number, THREE.Vector3>();
      const tempRotations = new Map<number, THREE.Euler>();

      props.selectedIds.forEach((id) => {
        const startS = startShapes.find((x) => x.id === id);
        const obj = refs.current.get(id);
        if (!startS || !obj) return;

        const startPosVec = new THREE.Vector3(...startS.position);
        const rotatedPos = startPosVec.applyMatrix4(mTransform);

        const startQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...startS.rotation),
        );
        const rotatedQuat = deltaQuat.clone().multiply(startQuat);
        const rotatedEuler = new THREE.Euler().setFromQuaternion(rotatedQuat);

        tempPositions.set(id, rotatedPos);
        tempRotations.set(id, rotatedEuler);

        const parent = obj.parent;
        if (parent) {
          obj.position.copy(parent.worldToLocal(rotatedPos.clone()));
        } else {
          obj.position.copy(rotatedPos);
        }
        obj.rotation.copy(rotatedEuler);
        obj.updateMatrixWorld(true);
      });

      const groupBox = new THREE.Box3();
      props.selectedIds.forEach((id) => {
        const obj = refs.current.get(id);
        if (obj) {
          groupBox.expandByObject(obj);
        }
      });

      let yShift = 0;
      if (groupBox.min.y < bounds.minY) {
        yShift = bounds.minY - groupBox.min.y;
      }

      props.selectedIds.forEach((id) => {
        const obj = refs.current.get(id);
        const rotatedPos = tempPositions.get(id);
        const rotatedEuler = tempRotations.get(id);
        if (obj && rotatedPos && rotatedEuler) {
          const finalPos = new THREE.Vector3(
            rotatedPos.x,
            rotatedPos.y + yShift,
            rotatedPos.z,
          );
          const parent = obj.parent;
          if (parent) {
            obj.position.copy(parent.worldToLocal(finalPos));
          } else {
            obj.position.copy(finalPos);
          }
          obj.rotation.copy(rotatedEuler);
          obj.updateMatrixWorld(true);
        }
      });
    }
  };

  const handleRotationDragEnd = (
    finalX: number,
    finalY: number,
    finalZ: number,
  ) => {
    if (!rotationDragRef.current) return;
    if (props.selectedIds.some((id) => props.shapes.find((s) => s.id === id)?.isLocked)) {
      rotationDragRef.current = null;
      return;
    }
    const { startShapes } = rotationDragRef.current;

    let updatedShapes = props.shapes;

    if (props.selectedIds.length === 1) {
      const targetId = props.selectedIds[0];
      const startS = startShapes.find((x) => x.id === targetId);
      if (startS) {
        const obj = refs.current.get(targetId);
        if (obj) {
          if (startS.jointParentId !== undefined) {
            // Child joint node
            updatedShapes = props.shapes.map((s) => {
              if (s.id !== targetId) return s;
              if (s.jointAxis === "xyz") {
                return {
                  ...s,
                  jointRotation: [finalX, finalY, finalZ] as [
                    number,
                    number,
                    number,
                  ],
                };
              } else {
                const activeVal =
                  s.jointAxis === "x"
                    ? finalX
                    : s.jointAxis === "y"
                      ? finalY
                      : finalZ;
                return {
                  ...s,
                  jointAngle: activeVal,
                };
              }
            });
            // Clear activeDragRotation
            obj.userData.activeDragRotation = null;
          } else {
            // Standard shape or root kinematic
            const radX = (finalX * Math.PI) / 180;
            const radY = (finalY * Math.PI) / 180;
            const radZ = (finalZ * Math.PI) / 180;

            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);

            updatedShapes = props.shapes.map((s) => {
              if (s.id !== targetId) return s;
              return {
                ...s,
                rotation: [radX, radY, radZ] as [number, number, number],
                position: [worldPos.x, worldPos.y, worldPos.z] as [
                  number,
                  number,
                  number,
                ],
              };
            });
          }
        }
      }
    } else {
      // Group selection
      updatedShapes = props.shapes.map((s) => {
        if (!props.selectedIds.includes(s.id)) return s;
        const obj = refs.current.get(s.id);
        if (!obj) return s;

        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);

        return {
          ...s,
          position: [worldPos.x, worldPos.y, worldPos.z] as [
            number,
            number,
            number,
          ],
          rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as [
            number,
            number,
            number,
          ],
        };
      });
    }

    props.setShapes(updatedShapes);
    props.savePathsToHistory(updatedShapes);
    rotationDragRef.current = null;
  };

  const handleResetRotation = (
    updateSlidersCallback: (x: number, y: number, z: number) => void,
  ) => {
    const targetIds = props.selectedIds;
    if (targetIds.length === 0) return;
    if (props.shapes.some((s) => targetIds.includes(s.id) && s.isLocked)) return;

    const newShapes = props.shapes.map((s) => {
      if (!targetIds.includes(s.id)) return s;

      if (s.jointParentId !== undefined) {
        // Joint node
        const obj = refs.current.get(s.id);
        if (obj) {
          obj.userData.activeDragRotation = null;
        }
        return {
          ...s,
          jointRotation: [0, 0, 0] as [number, number, number],
          jointAngle: 0,
        };
      } else {
        // Standard or root shape
        const obj = refs.current.get(s.id);
        let newY = s.position[1];
        if (obj) {
          obj.rotation.set(0, 0, 0);
          obj.updateMatrixWorld(true);

          const box = new THREE.Box3().setFromObject(obj);
          if (box.min.y < bounds.minY) {
            newY += bounds.minY - box.min.y;
          }

          obj.rotation.set(0, 0, 0);
          const parent = obj.parent;
          if (parent) {
            obj.position.copy(
              parent.worldToLocal(
                new THREE.Vector3(s.position[0], newY, s.position[2]),
              ),
            );
          } else {
            obj.position.set(s.position[0], newY, s.position[2]);
          }
          obj.updateMatrixWorld(true);
        }

        return {
          ...s,
          rotation: [0, 0, 0] as [number, number, number],
          position: [s.position[0], newY, s.position[2]] as [
            number,
            number,
            number,
          ],
        };
      }
    });

    props.setShapes(newShapes);
    props.savePathsToHistory(newShapes);
    updateSlidersCallback(0, 0, 0);
  };

  // URLs of every GLB referenced by a CSG member. Identity is kept stable
  // across edits that don't change the URL set (adding a primitive, dragging,
  // editing a field) so the loader below and its Suspense boundary don't
  // churn — an unstable array here used to rebuild the geometry map on every
  // single scene edit.
  const gltfUrlsRef = useRef<string[]>([]);
  const gltfUrls = useMemo(() => {
    const urls = new Set<string>();
    const collectUrls = (members: CustomMember[]) => {
      members.forEach((m) => {
        if (m.type === "glb" && m.url) urls.add(m.url);
        if (m.type === "custom" && m.customMembers) {
          collectUrls(m.customMembers);
        }
      });
    };
    shapes.forEach((s) => {
      if (s.type === "glb" && s.url) urls.add(s.url);
      if (s.type === "custom" && s.customMembers) {
        collectUrls(s.customMembers);
      }
    });
    const next = Array.from(urls).sort();
    const prev = gltfUrlsRef.current;
    if (prev.length === next.length && prev.every((u, i) => u === next[i])) {
      return prev;
    }
    gltfUrlsRef.current = next;
    return next;
  }, [shapes]);

  // Populated by <CsgGeometryLoader> below, which owns the suspending
  // `useGLTF` call inside its own Suspense boundary (see that file). Kept as
  // state here so a slow model load never unmounts the <Canvas>.
  const [gltfGeometryMap, setGltfGeometryMap] = useState<
    Map<string, THREE.BufferGeometry>
  >(() => new Map());
  const handleGltfMap = useCallback(
    (map: Map<string, THREE.BufferGeometry>) => setGltfGeometryMap(map),
    [],
  );

  const isHeavyScene = shapes.length > 150;
  const maxDpr = isHeavyScene ? 1 : 2;

  const selectedShapes = props.shapes.filter((s) =>
    props.selectedIds.includes(s.id),
  );
  const showRotationPanel =
    props.mode === "rotate" &&
    selectedShapes.length > 0 &&
    !selectedShapes.some((s) => s.isLocked);

  return (
    <div
      className="flex-1 relative w-full h-full"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragPointer({ x: e.clientX, y: e.clientY });
      }}
      onDragLeave={() => setDragPointer(null)}
      onDrop={(e) => {
        e.preventDefault();
        setDragPointer(null);
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;
        try {
          const payload = JSON.parse(raw);
          setPendingDrop({ clientX: e.clientX, clientY: e.clientY, payload });
        } catch (err) {
          // Drop payloads come from this app's own dragstart handler, so a
          // parse failure here means either a drag from another window or a
          // payload-shape change — both worth seeing rather than swallowing.
          console.warn("[Canvas3D] ignored a drop with an unparseable payload:", err);
        }
      }}
    >
      <div className="absolute top-5 left-5 z-10 pointer-events-none">
        <ViewportControls />
      </div>

      {sceneError && (
        <div
          role="alert"
          className="absolute top-5 left-1/2 -translate-x-1/2 z-20 max-w-[520px] px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-300 text-[11px] shadow-lg backdrop-blur-sm"
        >
          <span className="font-bold uppercase tracking-wider">Scene error</span>
          <span className="mx-2 opacity-40">|</span>
          <span className="opacity-90">
            An asset failed to load, so part of the scene is not rendering. See
            the console for details.
          </span>
          <button
            onClick={() => setSceneError(null)}
            className="ml-3 underline opacity-70 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {showRotationPanel && (
        <RotationControlPanel
          selectedShapes={selectedShapes}
          selectedIds={props.selectedIds}
          shapes={props.shapes}
          initRotationDrag={initRotationDrag}
          applyRotationUpdate={applyRotationUpdate}
          handleRotationDragEnd={handleRotationDragEnd}
          handleResetRotation={handleResetRotation}
          setSelectedIds={props.setSelectedIds}
        />
      )}
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={Math.min(window.devicePixelRatio, maxDpr)}
        flat
        gl={{
          antialias: !isHeavyScene,
          logarithmicDepthBuffer: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        onPointerMissed={() => {
          if (props.mode === "drawPath") return;
          props.setSelectedIds([]);
        }}
      >
        {/* Suspense handles *pending*; it does not catch *rejected*. A 404 or
        malformed .glb throws straight through it, and without this boundary
        that throw unwound to the route and blanked the app. The fallback is
        `null` rather than any element because we are inside <Canvas> — the
        user-facing notice is the DOM banner above, driven by onError. */}
        <ErrorBoundary
          label="CAD scene"
          fallback={null}
          onError={(err) => setSceneError(err.message || String(err))}
        >
          {/* Own boundary, sibling to the scene: while a CSG GLB downloads
          only this null-rendering loader suspends, so the already-drawn
          scene stays on screen instead of the whole <Canvas> remounting. */}
          <Suspense fallback={null}>
            <CsgGeometryLoader urls={gltfUrls} onMap={handleGltfMap} />
          </Suspense>
          <Suspense fallback={null}>
            <Scene
              {...props}
              gltfGeometryMap={gltfGeometryMap}
              meshRefs={refs}
              wsSettings={wsSettings}
            />
            <DropPlacement
              pendingDrop={pendingDrop}
              onConsumed={() => setPendingDrop(null)}
              addShape={props.addShape}
              addGlbShape={props.addGlbShape}
            />
            <GhostPreview
              placementRequest={props.placementRequest}
              setPlacementRequest={props.setPlacementRequest}
              addShape={props.addShape}
              addGlbShape={props.addGlbShape}
              pointerOverride={dragPointer}
            />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
    </div>
  );
}
