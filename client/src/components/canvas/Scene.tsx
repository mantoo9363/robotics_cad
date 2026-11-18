import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useThree, useFrame } from "@react-three/fiber";
import {
  PerspectiveCamera,
  OrthographicCamera,
  Grid,
  ContactShadows,
  OrbitControls,
  TransformControls,
  Edges,
  GizmoHelper,
} from "@react-three/drei";
import { CleanAxisMap } from "./CleanAxisMap";
import * as THREE from "three";
import { Evaluator } from "three-bvh-csg";
import type {
  ShapeType,
  MotionPath,
  GroupType,
  TransformMode,
  CustomMember,
} from "../../App";
import type { CircuitStreamFrame } from "../../lib/circuitStream";
import { getShapeMaterialProps } from "../../lib/materialUtils";
import PrimitiveGeometry from "./PrimitiveGeometry";
import ShapeMaterial from "./ShapeMaterial";
import type { MotionController } from "../../lib/motionController";
import type { WorkspaceSettings } from "../../types/workspace";
import { useGrabbingSystem } from "./utils/GrabbingSystem";
import WorkplaneSurface from "./WorkplaneSurface";
import BoundaryWalls from "./BoundaryWalls";
import PathRenderer from "./PathRenderer";
import AnimatedWrapper from "./AnimatedWrapper";
import CustomShapeMesh from "./CustomShapeMesh";
import { SuspendedGlbShapeMesh } from "./GlbShapeMesh";
import CSGGroup from "./CSGGroup";
import ScaleGizmo, { getRenderableLocalBox } from "./ScaleGizmo";
import UnifiedScaleGizmo from "./UnifiedScaleGizmo";
import JointMotionGroup from "./JointMotionGroup";
import KinematicNode from "./KinematicNode";

// Scratch objects reused by the per-frame translate-drag math (below) so the
// hot path allocates nothing. Safe as module singletons: the drag useFrame is
// single-threaded and fully consumes each before the next frame.
const _dragHit = new THREE.Vector3();
const _dragWorldPos = new THREE.Vector3();
const _dragLocalTarget = new THREE.Vector3();
const _dragBox = new THREE.Box3();

type SceneProps = {
  shapes: ShapeType[];
  groups: GroupType[];
  motorGroups: import("../../App").MotorGroup[];
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
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>;
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>;
};

type DragState = {
  active: boolean;
  targets: number[];
  isYAxis: boolean;
  arrowAxis?: "x" | "y" | "z" | null;
  startPt: THREE.Vector3;
  startPositions: Map<number, THREE.Vector3>;
  groupOffsets: Map<number, THREE.Vector3>; // CSGGroup: obj.position offset at drag start
  // id -> (world-space bbox min.y at drag start) minus (world Y of the object's
  // transform origin at drag start). Translation-invariant, so the per-frame
  // floor clamp predicts the new bottom as (currentWorldY + bottomOffset)
  // instead of a full-tree Box3.setFromObject() every frame.
  bottomOffsets: Map<number, number>;
};

// Members of a single group (boolean CSG groups always, standard groups
// when fully selected) share ONE Object3D wrapper transform — dragging any
// member visually moves all of them, including locked ones. So a lock on
// any member must block the whole group's drag rather than being filtered
// out of the target list (which would silently leave the wrapper movable).
function isAtomicGroupSelection(shapesArr: ShapeType[]): boolean {
  return (
    shapesArr.length > 1 &&
    shapesArr[0].parentId !== undefined &&
    shapesArr.every((s) => s.parentId === shapesArr[0].parentId)
  );
}

export default function Scene({
  shapes,
  groups,
  setSelectedIds,
  selectedIds,
  setShapes,
  mode,
  snapToGrid,
  snapIncrement,
  gridSize,
  paths,
  setPaths,
  selectedPathId,
  setSelectedPathId,
  selectedPathIds = [],
  showPaths,
  drawingAltitude,
  activePathWP,
  setActivePathWP,
  savePathsToHistory,
  simulationFrame,
  gltfGeometryMap,
  brushSize,
  brushShape,
  scaleFromSide,
  motionController,
  motorGroups,
  meshRefs,
  wsSettings,
}: SceneProps) {
  const { camera, raycaster, pointer, gl } = useThree();
  useGrabbingSystem(shapes, setShapes, meshRefs);
  const [isBusy, setIsBusy] = useState(false);

  // Read via ref inside handleShapeDown so that callback keeps a stable
  // identity across shape edits (add/subtract, drags, etc). shapes changes on
  // nearly every scene edit; putting it in handleShapeDown's dep array busted
  // the CSGGroup React.memo below on every edit, re-rendering every boolean
  // group in the scene instead of just the one that changed.
  const shapesRef = useRef(shapes);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  // Viewport navigation and camera controls state / refs
  const [cameraType, setCameraType] = useState<"perspective" | "orthographic">(
    "perspective",
  );
  // When true, disables OrbitControls (mouse drag/scroll orbit, pan, zoom on
  // the canvas) — but NOT the ViewCube: handleOrbit below drives the camera
  // directly via cameraTargetPos/cameraTargetLookAt rather than through
  // OrbitControls, so it stays usable regardless of this flag, same as the
  // Home/Fit/Zoom toolbar buttons.
  const [cameraLocked, setCameraLocked] = useState(false);
  const orbitControlsRef = useRef<any>(null);
  const cameraTargetPos = useRef<THREE.Vector3 | null>(null);
  const cameraTargetLookAt = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    const handleSnap = (e: Event) => {
      const dir = (e as CustomEvent).detail;
      const targetLook =
        orbitControlsRef.current?.target.clone() || new THREE.Vector3(0, 0, 0);
      const targetPos = targetLook.clone();
      const dist = 80;

      switch (dir) {
        case "top":
          targetPos.y += dist;
          break;
        case "bottom":
          targetPos.y -= dist;
          break;
        case "front":
          targetPos.z += dist;
          break;
        case "back":
          targetPos.z -= dist;
          break;
        case "left":
          targetPos.x -= dist;
          break;
        case "right":
          targetPos.x += dist;
          break;
        default:
          return;
      }

      cameraTargetPos.current = targetPos;
      cameraTargetLookAt.current = targetLook;
    };

    const handleReset = () => {
      cameraTargetPos.current = new THREE.Vector3(50, 50, 50);
      cameraTargetLookAt.current = new THREE.Vector3(0, 0, 0);
    };

    const handleZoomIn = () => {
      const target =
        orbitControlsRef.current?.target || new THREE.Vector3(0, 0, 0);
      const diff = camera.position.clone().sub(target);
      diff.multiplyScalar(0.75);
      cameraTargetPos.current = target.clone().add(diff);
      cameraTargetLookAt.current = target.clone();
    };

    const handleZoomOut = () => {
      const target =
        orbitControlsRef.current?.target || new THREE.Vector3(0, 0, 0);
      const diff = camera.position.clone().sub(target);
      diff.multiplyScalar(1.3);
      cameraTargetPos.current = target.clone().add(diff);
      cameraTargetLookAt.current = target.clone();
    };

    const handleFit = () => {
      const box = new THREE.Box3();
      let count = 0;
      selectedIds.forEach((id) => {
        const obj = meshRefs.current.get(id);
        if (obj) {
          box.expandByObject(obj);
          count++;
        }
      });
      if (count === 0) {
        shapes.forEach((s) => {
          const obj = meshRefs.current.get(s.id);
          if (obj) box.expandByObject(obj);
        });
      }
      if (!box.isEmpty()) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = Math.max(maxDim * 1.5, 20);
        cameraTargetPos.current = new THREE.Vector3(
          center.x + dist,
          center.y + dist,
          center.z + dist,
        );
        cameraTargetLookAt.current = center;
      }
    };

    const handleOrthoToggle = () => {
      setCameraType((prev) =>
        prev === "perspective" ? "orthographic" : "perspective",
      );
    };

    const handleLockToggle = () => {
      setCameraLocked((prev) => !prev);
    };

    const handleOrbit = (e: Event) => {
      const { dx, dy } = (e as CustomEvent).detail;
      const target = orbitControlsRef.current?.target || new THREE.Vector3(0, 0, 0);
      const offset = camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.012;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - dy * 0.012));
      const newPos = new THREE.Vector3().setFromSpherical(spherical).add(target);
      cameraTargetPos.current = newPos;
      cameraTargetLookAt.current = target;
    };

    window.addEventListener("camera-snap", handleSnap);
    window.addEventListener("camera-reset", handleReset);
    window.addEventListener("camera-zoom-in", handleZoomIn);
    window.addEventListener("camera-zoom-out", handleZoomOut);
    window.addEventListener("camera-fit", handleFit);
    window.addEventListener("camera-ortho-toggle", handleOrthoToggle);
    window.addEventListener("camera-lock-toggle", handleLockToggle);
    window.addEventListener("camera-orbit", handleOrbit);

    return () => {
      window.removeEventListener("camera-snap", handleSnap);
      window.removeEventListener("camera-reset", handleReset);
      window.removeEventListener("camera-zoom-in", handleZoomIn);
      window.removeEventListener("camera-zoom-out", handleZoomOut);
      window.removeEventListener("camera-fit", handleFit);
      window.removeEventListener("camera-ortho-toggle", handleOrthoToggle);
      window.removeEventListener("camera-lock-toggle", handleLockToggle);
      window.removeEventListener("camera-orbit", handleOrbit);
    };
  }, [camera, selectedIds, shapes, meshRefs]);

  useFrame((state) => {
    if (cameraTargetPos.current && cameraTargetLookAt.current) {
      const before = state.camera.position.distanceTo(cameraTargetPos.current);
      state.camera.position.lerp(cameraTargetPos.current, 0.15);
      if (orbitControlsRef.current) {
        orbitControlsRef.current.target.lerp(cameraTargetLookAt.current, 0.15);
        orbitControlsRef.current.update();
      }
      const after = state.camera.position.distanceTo(cameraTargetPos.current);
      // Stop chasing once we've arrived OR once we've stopped making progress.
      // orbitControlsRef.update() re-derives the camera position from its own
      // spherical state every frame, so after a ViewCube orbit the lerp and
      // update() can fight to a standstill just outside the 0.1 threshold — the
      // target would then never clear, pinning the camera and swallowing every
      // scroll-wheel zoom on the next frame. The progress check releases it.
      if (after < 0.1 || before - after < 0.001) {
        cameraTargetPos.current = null;
        cameraTargetLookAt.current = null;
      }
    }

    const euler = new THREE.Euler().setFromQuaternion(
      state.camera.quaternion,
      "YXZ",
    );
    window.dispatchEvent(
      new CustomEvent("camera-rotation-change", {
        detail: { x: euler.x, y: euler.y },
      }),
    );
  });

  const evaluator = useMemo(() => {
    const e = new Evaluator();
    e.attributes = ["position", "normal", "color", "uv"];
    return e;
  }, []);
  const exportGroupRef = useRef<THREE.Group>(null);

  const updateBaseSize = useCallback(
    (id: number, baseSize: [number, number, number]) => {
      // No logging here: onLoaded can fire on every frame for an animated
      // shape, and a per-frame console.log with DevTools open is enough on its
      // own to freeze the tab. The setShapes updater already no-ops when the
      // size is unchanged, so the repeated calls are otherwise harmless.
      setShapes((prev) => {
        const existing = prev.find((s) => s.id === id);
        if (
          existing &&
          (!existing.baseSize ||
            existing.baseSize[0] !== baseSize[0] ||
            existing.baseSize[1] !== baseSize[1] ||
            existing.baseSize[2] !== baseSize[2])
        ) {
          return prev.map((s) => (s.id === id ? { ...s, baseSize } : s));
        }
        return prev;
      });
    },
    [setShapes],
  );

  const isAltPressedRef = useRef(false);
  const isCtrlPressedRef = useRef(false);
  const isShiftPressedRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        isAltPressedRef.current = true;
      }
      if (e.key === "Control") {
        isCtrlPressedRef.current = true;
      }
      if (e.key === "Shift") {
        isShiftPressedRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        isAltPressedRef.current = false;
      }
      if (e.key === "Control") {
        isCtrlPressedRef.current = false;
      }
      if (e.key === "Shift") {
        isShiftPressedRef.current = false;
      }
    };
    const handleBlur = () => {
      isAltPressedRef.current = false;
      isCtrlPressedRef.current = false;
      isShiftPressedRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Erase Tool State & Logic
  const [erasePreview, setErasePreview] = useState<{
    point: [number, number, number];
    shapeId: number;
  } | null>(null);

  useFrame((state) => {
    if (mode !== "erase") {
      if (erasePreview) setErasePreview(null);
      return;
    }
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const intersects = state.raycaster.intersectObjects(
      state.scene.children,
      true,
    );
    let found: { point: THREE.Vector3; shapeId: number } | null = null;

    for (const hit of intersects) {
      if (hit.object.name === "erase-brush-preview") continue;

      let curr: THREE.Object3D | null = hit.object;
      while (curr) {
        if (curr.userData && curr.userData.shapeId !== undefined) {
          found = { point: hit.point, shapeId: curr.userData.shapeId };
          break;
        }
        curr = curr.parent;
      }
      if (found) break;
    }

    if (found) {
      setErasePreview({
        point: [found.point.x, found.point.y, found.point.z],
        shapeId: found.shapeId,
      });
    } else {
      setErasePreview(null);
    }
  });

  const handleEraseClick = useCallback(
    (shapeId: number, worldPoint: THREE.Vector3) => {
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape || shape.isLocked) return;

      const shapeMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...shape.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...shape.rotation)),
        new THREE.Vector3(...shape.scale),
      );
      const localPoint = worldPoint.clone().applyMatrix4(shapeMatrix.invert());

      const localScale: [number, number, number] = [
        (brushSize ?? 1.0) / shape.scale[0],
        (brushSize ?? 1.0) / shape.scale[1],
        (brushSize ?? 1.0) / shape.scale[2],
      ];

      const updatedShapes = shapes.map((s) => {
        if (s.id !== shapeId) return s;

        let customMembers: CustomMember[] = [];
        if (s.type === "custom" && s.customMembers) {
          customMembers = [...s.customMembers];
        } else {
          customMembers = [
            {
              type: s.type as any,
              url: s.url,
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              isHole: false,
              color: s.color,
            },
          ];
        }

        customMembers.push({
          type: brushShape ?? "sphere",
          offset: [localPoint.x, localPoint.y, localPoint.z],
          rotation: [0, 0, 0],
          scale: localScale,
          isHole: true,
          color: s.color,
        });

        return {
          ...s,
          type: "custom" as const,
          customMembers,
        };
      });

      savePathsToHistory(updatedShapes);
    },
    [shapes, brushSize, brushShape, savePathsToHistory],
  );

  useEffect(() => {
    if (mode !== "erase") return;

    const handleWindowClick = (e: PointerEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (!erasePreview) return;

      handleEraseClick(
        erasePreview.shapeId,
        new THREE.Vector3(...erasePreview.point),
      );
    };

    window.addEventListener("pointerdown", handleWindowClick);
    return () => window.removeEventListener("pointerdown", handleWindowClick);
  }, [mode, erasePreview, handleEraseClick]);

  useEffect(() => {
    const handleExport = () => {
      setSelectedIds([]);
      setTimeout(async () => {
        if (!exportGroupRef.current) return;
        // Loaded on demand: the exporters are only reachable via these
        // toolbar actions, so they don't belong in the main chunk.
        const { STLExporter } = await import(
          "three/examples/jsm/exporters/STLExporter.js"
        );
        const exporter = new STLExporter();
        const result = exporter.parse(exportGroupRef.current, { binary: true });
        const blob = new Blob([result as BlobPart], {
          type: "application/octet-stream",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.style.display = "none";
        link.href = url;
        link.download = "cad-studio-model.stl";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 50);
    };
    const handleGLBExport = () => {
      setSelectedIds([]);
      setTimeout(async () => {
        if (!exportGroupRef.current) return;
        const { GLTFExporter } = await import(
          "three/examples/jsm/exporters/GLTFExporter.js"
        );
        const exporter = new GLTFExporter();
        exporter.parse(
          exportGroupRef.current,
          (gltf) => {
            const blob = new Blob([gltf as ArrayBuffer], {
              type: "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.style.display = "none";
            link.href = url;
            link.download = "cad-studio-model.glb";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          },
          (err) => console.error(err),
          { binary: true },
        );
      }, 50);
    };

    window.addEventListener("trigger-stl-export", handleExport);
    window.addEventListener("trigger-glb-export", handleGLBExport);
    return () => {
      window.removeEventListener("trigger-stl-export", handleExport);
      window.removeEventListener("trigger-glb-export", handleGLBExport);
    };
  }, [setSelectedIds]);

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

  const shiftObjectWorldY = useCallback(
    (obj: THREE.Object3D, yShift: number) => {
      if (obj.userData.isCSGGroup) {
        obj.position.y += yShift;
        obj.updateMatrixWorld(true);
        return;
      }

      if (obj.parent) {
        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);
        worldPos.y += yShift;
        obj.position.copy(obj.parent.worldToLocal(worldPos));
      } else {
        obj.position.y += yShift;
      }
      obj.updateMatrixWorld(true);
    },
    [],
  );

  const keepObjectAboveCanvas = useCallback(
    (obj: THREE.Object3D) => {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty() || box.min.y >= bounds.minY) return false;

      shiftObjectWorldY(obj, bounds.minY - box.min.y);
      return true;
    },
    [bounds.minY, shiftObjectWorldY],
  );

  const drag = useRef<DragState>({
    active: false,
    targets: [],
    isYAxis: false,
    arrowAxis: null,
    startPt: new THREE.Vector3(),
    startPositions: new Map(),
    groupOffsets: new Map(),
    bottomOffsets: new Map(),
  });

  const scaleDrag = useRef({
    active: false,
    shapeId: 0,
    direction: "",
    startPt: new THREE.Vector3(),
    startScale: [1, 1, 1] as [number, number, number],
    startPosition: [0, 0, 0] as [number, number, number],
    startBaseSize: [1, 1, 1] as [number, number, number],
    startBox: null as THREE.Box3 | null,
    startShapesState: [] as Array<{
      id: number;
      position: [number, number, number];
      scale: [number, number, number];
      rotation: [number, number, number];
    }>,
  });
  const dragPlane = useMemo(() => new THREE.Plane(), []);

  const cogwheelTypes = new Set(["cogwheel", "cogwheel-6t", "cogwheel-8t", "cogwheel-12t", "cogwheel-16t"]);

  function getCogwheelOuterRadius(type: string): number {
    return 0.5; // outerRadius from geometryHelpers
  }

  const cogCouplings = useRef<Map<number, number[]>>(new Map());

  function rebuildCogCouplings(shapeList: ShapeType[]) {
    const cogs = shapeList.filter((s) => cogwheelTypes.has(s.type));
    const pairMap = new Map<number, number[]>();
    for (let i = 0; i < cogs.length; i++) {
      for (let j = i + 1; j < cogs.length; j++) {
        const a = cogs[i], b = cogs[j];
        if (a.type !== b.type) continue;
        const dx = a.position[0] - b.position[0];
        const dz = a.position[2] - b.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const expectedGap = getCogwheelOuterRadius(a.type) * 2 * Math.max(a.scale[0], b.scale[0]);
        const tolerance = expectedGap * 0.15;
        if (Math.abs(dist - expectedGap) < tolerance) {
          if (!pairMap.has(a.id)) pairMap.set(a.id, []);
          if (!pairMap.has(b.id)) pairMap.set(b.id, []);
          pairMap.get(a.id)!.push(b.id);
          pairMap.get(b.id)!.push(a.id);
        }
      }
    }
    cogCouplings.current = pairMap;
  }

  function snapCogwheelPos(shape: ShapeType, allShapes: ShapeType[]): [number, number, number] | null {
    if (!cogwheelTypes.has(shape.type)) return null;
    const radius = getCogwheelOuterRadius(shape.type);
    const expectedGap = radius * 2 * shape.scale[0];
    const snapThreshold = expectedGap * 0.2;
    for (const other of allShapes) {
      if (other.id === shape.id || !cogwheelTypes.has(other.type)) continue;
      if (other.type !== shape.type) continue;
      const dx = shape.position[0] - other.position[0];
      const dz = shape.position[2] - other.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (Math.abs(dist - expectedGap) < snapThreshold) {
        const angle = Math.atan2(dz, dx);
        return [
          other.position[0] + Math.cos(angle) * expectedGap,
          shape.position[1],
          other.position[2] + Math.sin(angle) * expectedGap,
        ];
      }
    }
    return null;
  }

  const handlePointerUp = useCallback(() => {
    if (drag.current.active) {
      drag.current.active = false;
      drag.current.arrowAxis = null;
      setIsBusy(false);
      gl.domElement.style.cursor = "auto";

      const groupsToReset = new Set<THREE.Object3D>();
      let changed = false;
      let newShapes = shapes.map((s) => {
        const obj = meshRefs.current.get(s.id);
        if (!obj || !drag.current.targets.includes(s.id)) return s;

        const wp = new THREE.Vector3();
        if (obj.userData.isCSGGroup) {
          wp.set(...s.position).add(obj.position);
          groupsToReset.add(obj);
        } else {
          obj.getWorldPosition(wp);
        }

        const cx = Math.max(bounds.minX, Math.min(bounds.maxX, wp.x));
        let cy = wp.y;
        const cz = Math.max(bounds.minZ, Math.min(bounds.maxZ, wp.z));

        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        if (box.min.y < bounds.minY) {
          cy += bounds.minY - box.min.y;
        }
        cy = Math.max(bounds.minY, cy);

        const distSq =
          Math.pow(cx - s.position[0], 2) +
          Math.pow(cy - s.position[1], 2) +
          Math.pow(cz - s.position[2], 2);
        if (distSq > 0.0001) {
          changed = true;
        }

        return { ...s, position: [cx, cy, cz] as [number, number, number] };
      });

      groupsToReset.forEach((gObj) => {
        gObj.position.set(0, 0, 0);
      });

      // Snap cogwheels to meshing positions
      if (changed) {
        const draggedIds = new Set(drag.current.targets);
        newShapes = newShapes.map((s) => {
          if (!draggedIds.has(s.id)) return s;
          const snapped = snapCogwheelPos(s, newShapes);
          if (snapped) {
            changed = true;
            return { ...s, position: snapped };
          }
          return s;
        });
      }

      if (changed) {
        savePathsToHistory(newShapes);
        rebuildCogCouplings(newShapes);
      } else {
        setShapes(newShapes);
      }
    }

    if (scaleDrag.current.active) {
      scaleDrag.current.active = false;
      setIsBusy(false);
      gl.domElement.style.cursor = "auto";

      if (
        scaleDrag.current.startBox &&
        scaleDrag.current.startShapesState.length > 0
      ) {
        let changed = false;
        const newShapes = shapes.map((s) => {
          if (!selectedIds.includes(s.id)) return s;

          const obj = meshRefs.current.get(s.id);
          if (!obj) return s;

          const scaleObj = obj.userData.scaleGroup || obj;
          const scaleDiffSq =
            Math.pow(scaleObj.scale.x - s.scale[0], 2) +
            Math.pow(scaleObj.scale.y - s.scale[1], 2) +
            Math.pow(scaleObj.scale.z - s.scale[2], 2);
          const posDiffSq =
            Math.pow(obj.position.x - s.position[0], 2) +
            Math.pow(obj.position.y - s.position[1], 2) +
            Math.pow(obj.position.z - s.position[2], 2);

          if (scaleDiffSq > 0.0001 || posDiffSq > 0.0001) {
            changed = true;
          }

          return {
            ...s,
            scale: [scaleObj.scale.x, scaleObj.scale.y, scaleObj.scale.z] as [
              number,
              number,
              number,
            ],
            position: [obj.position.x, obj.position.y, obj.position.z] as [
              number,
              number,
              number,
            ],
          };
        });

        if (changed) {
          savePathsToHistory(newShapes);
        } else {
          setShapes(newShapes);
        }

        scaleDrag.current.startBox = null;
        scaleDrag.current.startShapesState = [];
      } else {
        const shapeId = scaleDrag.current.shapeId;
        const obj = meshRefs.current.get(shapeId);
        if (obj) {
          let changed = false;
          const scaleObj = obj.userData.scaleGroup || obj;
          const newShapes = shapes.map((s) => {
            if (s.id !== shapeId) return s;

            const scaleDiffSq =
              Math.pow(scaleObj.scale.x - s.scale[0], 2) +
              Math.pow(scaleObj.scale.y - s.scale[1], 2) +
              Math.pow(scaleObj.scale.z - s.scale[2], 2);
            const posDiffSq =
              Math.pow(obj.position.x - s.position[0], 2) +
              Math.pow(obj.position.y - s.position[1], 2) +
              Math.pow(obj.position.z - s.position[2], 2);

            if (scaleDiffSq > 0.0001 || posDiffSq > 0.0001) {
              changed = true;
            }

            let finalY = obj.position.y;
            obj.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(obj);
            if (box.min.y < bounds.minY) {
              finalY += bounds.minY - box.min.y;
            }
            finalY = Math.max(bounds.minY, finalY);

            return {
              ...s,
              scale: [scaleObj.scale.x, scaleObj.scale.y, scaleObj.scale.z] as [
                number,
                number,
                number,
              ],
              position: [obj.position.x, finalY, obj.position.z] as [
                number,
                number,
                number,
              ],
            };
          });

          if (changed) {
            savePathsToHistory(newShapes);
          } else {
            setShapes(newShapes);
          }
        }
      }
    }
  }, [
    gl,
    setShapes,
    shapes,
    savePathsToHistory,
    bounds,
    selectedIds,
    meshRefs,
  ]);

  const startScaleDrag = useCallback(
    (e: any, shape: ShapeType, direction: string) => {
      if (
        shape.isLocked ||
        (selectedIds.length > 1 &&
          selectedIds.some((id) => shapes.find((s) => s.id === id)?.isLocked))
      ) {
        return;
      }
      e.stopPropagation();
      setIsBusy(true);
      gl.domElement.style.cursor = "ew-resize";

      scaleDrag.current.active = true;
      scaleDrag.current.shapeId = shape.id;
      scaleDrag.current.direction = direction;
      scaleDrag.current.startPt.copy(e.point);
      scaleDrag.current.startScale = [...shape.scale] as [
        number,
        number,
        number,
      ];
      scaleDrag.current.startPosition = [...shape.position] as [
        number,
        number,
        number,
      ];
      const obj = meshRefs.current.get(shape.id);
      const scaleObj = obj?.userData.scaleGroup || obj;
      if (scaleObj) {
        const baseBox = getRenderableLocalBox(
          scaleObj,
          shape.baseSize || [1, 1, 1],
        );
        const baseSize = new THREE.Vector3();
        baseBox.getSize(baseSize);
        scaleDrag.current.startBaseSize = [
          baseSize.x || 1,
          baseSize.y || 1,
          baseSize.z || 1,
        ];
      } else {
        scaleDrag.current.startBaseSize = shape.baseSize || [1, 1, 1];
      }

      if (selectedIds.length > 1) {
        const combinedBox = new THREE.Box3();
        const startStates: Array<{
          id: number;
          position: [number, number, number];
          scale: [number, number, number];
          rotation: [number, number, number];
        }> = [];

        selectedIds.forEach((id) => {
          const s = shapes.find((x) => x.id === id);
          if (s) {
            const shapeBox = new THREE.Box3().setFromCenterAndSize(
              new THREE.Vector3(...s.position),
              new THREE.Vector3(...s.scale),
            );
            combinedBox.union(shapeBox);
            startStates.push({
              id: s.id,
              position: [...s.position] as [number, number, number],
              scale: [...s.scale] as [number, number, number],
              rotation: [...s.rotation] as [number, number, number],
            });
          }
        });

        scaleDrag.current.startBox = combinedBox;
        scaleDrag.current.startShapesState = startStates;
      } else {
        scaleDrag.current.startBox = null;
        scaleDrag.current.startShapesState = [];
      }

      const isY = direction.includes("y");
      if (isY) {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        dragPlane.setFromNormalAndCoplanarPoint(
          camDir.clone().negate(),
          e.point,
        );
      } else {
        dragPlane.setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          e.point,
        );
      }
    },
    [camera, dragPlane, gl, selectedIds, shapes, meshRefs],
  );

  useEffect(() => {
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerUp]);

  const startDrag = useCallback(
    (
      e: any,
      targetShapes: ShapeType[],
      forcedAxis?: "x" | "y" | "z" | null,
    ) => {
      if (mode !== "translate") return;
      if (targetShapes.some((s) => s.isLocked)) return;

      setIsBusy(true);
      gl.domElement.style.cursor = "grabbing";

      const isAlt = e.altKey || forcedAxis === "y";
      drag.current.active = true;
      drag.current.targets = targetShapes.map((s) => s.id);
      drag.current.isYAxis = isAlt;
      drag.current.arrowAxis = forcedAxis || null;
      drag.current.startPt.copy(e.point);
      drag.current.startPositions.clear();
      drag.current.groupOffsets.clear();
      drag.current.bottomOffsets.clear();

      targetShapes.forEach((s) => {
        const obj = meshRefs.current.get(s.id);
        if (obj) {
          // Measure the world-space bottom ONCE, relative to the object's
          // transform origin. Reused every drag frame for the floor clamp.
          obj.updateMatrixWorld(true);
          _dragBox.setFromObject(obj);
          if (!_dragBox.isEmpty() && Number.isFinite(_dragBox.min.y)) {
            obj.getWorldPosition(_dragWorldPos);
            drag.current.bottomOffsets.set(s.id, _dragBox.min.y - _dragWorldPos.y);
          }
        }
        if (obj && obj.userData.isCSGGroup) {
          // Save rendered position = stored position + group wrapper offset
          const groupOff = obj.position.clone();
          drag.current.groupOffsets.set(s.id, groupOff);
          drag.current.startPositions.set(
            s.id,
            new THREE.Vector3(
              s.position[0] + groupOff.x,
              s.position[1] + groupOff.y,
              s.position[2] + groupOff.z,
            ),
          );
        } else if (obj) {
          const wp = new THREE.Vector3();
          obj.getWorldPosition(wp);
          drag.current.startPositions.set(s.id, wp.clone());
        } else {
          drag.current.startPositions.set(
            s.id,
            new THREE.Vector3(...s.position),
          );
        }
      });

      if (isAlt) {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        dragPlane.setFromNormalAndCoplanarPoint(
          camDir.clone().negate(),
          e.point,
        );
      } else {
        dragPlane.setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          e.point,
        );
      }
    },
    [mode, camera, dragPlane, gl, meshRefs],
  );

  useFrame(() => {
    if (!drag.current.active) return;
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(dragPlane, _dragHit)) return;

    let ddx = 0;
    let ddy = 0;
    let ddz = 0;

    if (drag.current.arrowAxis) {
      if (drag.current.arrowAxis === "x") {
        ddx = _dragHit.x - drag.current.startPt.x;
      } else if (drag.current.arrowAxis === "y") {
        ddy = _dragHit.y - drag.current.startPt.y;
      } else if (drag.current.arrowAxis === "z") {
        ddz = _dragHit.z - drag.current.startPt.z;
      }
    } else {
      ddx = drag.current.isYAxis ? 0 : _dragHit.x - drag.current.startPt.x;
      ddy = drag.current.isYAxis ? _dragHit.y - drag.current.startPt.y : 0;
      ddz = drag.current.isYAxis ? 0 : _dragHit.z - drag.current.startPt.z;
    }

    drag.current.targets.forEach((id) => {
      const obj = meshRefs.current.get(id);
      const sp = drag.current.startPositions.get(id);
      if (!obj || !sp) return;

      let nx = sp.x + ddx;
      let ny = sp.y + ddy;
      let nz = sp.z + ddz;

      if (snapToGrid) {
        nx = Math.round(nx / snapIncrement) * snapIncrement;
        ny = Math.round(ny / snapIncrement) * snapIncrement;
        nz = Math.round(nz / snapIncrement) * snapIncrement;
      }

      nx = Math.max(bounds.minX, Math.min(bounds.maxX, nx));
      nz = Math.max(bounds.minZ, Math.min(bounds.maxZ, nz));
      ny = Math.max(bounds.minY, ny);

      const parent = obj.parent;
      if (obj.userData.isCSGGroup) {
        // Preserve the group wrapper offset from keepObjectAboveCanvas
        // by computing obj.position relative to the stored state position
        const goff = drag.current.groupOffsets.get(id);
        if (goff) {
          // sp = storedStatePos + goff, so statePos = sp - goff
          // We want: statePos + obj.position = (nx, ny, nz)
          // obj.position = (nx, ny, nz) - (sp - goff) = (nx - sp.x + goff.x, ...)
          obj.position.set(
            nx - sp.x + goff.x,
            ny - sp.y + goff.y,
            nz - sp.z + goff.z,
          );
        } else {
          obj.position.set(nx - sp.x, ny - sp.y, nz - sp.z);
        }
      } else if (parent) {
        _dragLocalTarget.set(nx, ny, nz);
        obj.position.copy(parent.worldToLocal(_dragLocalTarget));
      } else {
        obj.position.set(nx, ny, nz);
      }

      obj.updateMatrixWorld(true);

      // Floor clamp without a per-frame full-tree bbox: translation doesn't
      // change the object's shape, so its world bottom is
      // (currentWorldY + bottomOffset), where bottomOffset was measured once
      // in startDrag. Objects with no measurable geometry are simply skipped.
      const bottomOffset = drag.current.bottomOffsets.get(id);
      if (bottomOffset !== undefined) {
        obj.getWorldPosition(_dragWorldPos);
        const predictedMinY = _dragWorldPos.y + bottomOffset;
        if (predictedMinY < bounds.minY) {
          shiftObjectWorldY(obj, bounds.minY - predictedMinY);
        }
      }
    });
  });

  useFrame(() => {
    if (!scaleDrag.current.active) return;
    raycaster.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(dragPlane, hit)) return;

    const dir = scaleDrag.current.direction;
    const startBox = scaleDrag.current.startBox;

    if (startBox && scaleDrag.current.startShapesState.length > 0) {
      const startBoxMin = startBox.min.clone();
      const startBoxMax = startBox.max.clone();
      const startBoxCenter = new THREE.Vector3();
      startBox.getCenter(startBoxCenter);

      const anchor = new THREE.Vector3();
      const startPoint = new THREE.Vector3();

      // For X axis
      if (scaleFromSide) {
        if (dir.includes("-x")) {
          anchor.x = startBoxMax.x;
          startPoint.x = startBoxMin.x;
        } else {
          anchor.x = startBoxMin.x;
          startPoint.x = startBoxMax.x;
        }
      } else {
        anchor.x = startBoxCenter.x;
        startPoint.x = dir.includes("-x") ? startBoxMin.x : startBoxMax.x;
      }

      // For Y axis
      if (scaleFromSide) {
        if (dir.includes("-y")) {
          anchor.y = startBoxMax.y;
          startPoint.y = startBoxMin.y;
        } else {
          anchor.y = startBoxMin.y;
          startPoint.y = startBoxMax.y;
        }
      } else {
        anchor.y = startBoxCenter.y;
        startPoint.y = dir.includes("-y") ? startBoxMin.y : startBoxMax.y;
      }

      // For Z axis
      if (scaleFromSide) {
        if (dir.includes("-z")) {
          anchor.z = startBoxMax.z;
          startPoint.z = startBoxMin.z;
        } else {
          anchor.z = startBoxMin.z;
          startPoint.z = startBoxMax.z;
        }
      } else {
        anchor.z = startBoxCenter.z;
        startPoint.z = dir.includes("-z") ? startBoxMin.z : startBoxMax.z;
      }

      const currentHit = hit.clone();
      let fx = dir.includes("x")
        ? Math.max(0.1, (currentHit.x - anchor.x) / (startPoint.x - anchor.x))
        : 1.0;
      let fy = dir.includes("y")
        ? Math.max(0.1, (currentHit.y - anchor.y) / (startPoint.y - anchor.y))
        : 1.0;
      let fz = dir.includes("z")
        ? Math.max(0.1, (currentHit.z - anchor.z) / (startPoint.z - anchor.z))
        : 1.0;

      const isShift = isShiftPressedRef.current;
      if (isShift) {
        let ratio = 1.0;
        if (dir.includes("x")) {
          ratio = fx;
        } else if (dir.includes("z")) {
          ratio = fz;
        } else if (dir.includes("y")) {
          ratio = fy;
        }
        fx = ratio;
        fy = ratio;
        fz = ratio;
      }

      scaleDrag.current.startShapesState.forEach((startState) => {
        const obj = meshRefs.current.get(startState.id);
        if (!obj) return;

        const startPos = new THREE.Vector3(...startState.position);
        const startScale = new THREE.Vector3(...startState.scale);

        const newPos = anchor
          .clone()
          .add(
            new THREE.Vector3(
              (startPos.x - anchor.x) * fx,
              (startPos.y - anchor.y) * fy,
              (startPos.z - anchor.z) * fz,
            ),
          );

        const newScaleVec = new THREE.Vector3(
          startScale.x * fx,
          startScale.y * fy,
          startScale.z * fz,
        );

        const scaleObj = obj.userData.scaleGroup || obj;
        scaleObj.scale.set(
          Math.max(0.1, newScaleVec.x),
          Math.max(0.1, newScaleVec.y),
          Math.max(0.1, newScaleVec.z),
        );
        obj.position.set(newPos.x, newPos.y, newPos.z);

        if (snapToGrid) {
          const snappedScale = scaleObj.scale.clone();
          snappedScale.x =
            Math.round(snappedScale.x / snapIncrement) * snapIncrement;
          snappedScale.y =
            Math.round(snappedScale.y / snapIncrement) * snapIncrement;
          snappedScale.z =
            Math.round(snappedScale.z / snapIncrement) * snapIncrement;
          scaleObj.scale.copy(snappedScale);

          const snappedPos = obj.position.clone();
          snappedPos.x =
            Math.round(snappedPos.x / snapIncrement) * snapIncrement;
          snappedPos.y =
            Math.round(snappedPos.y / snapIncrement) * snapIncrement;
          snappedPos.z =
            Math.round(snappedPos.z / snapIncrement) * snapIncrement;
          obj.position.copy(snappedPos);
        }

        obj.updateMatrixWorld(true);
      });

      let combinedBox = new THREE.Box3();
      selectedIds.forEach((id) => {
        const obj = meshRefs.current.get(id);
        if (obj) {
          obj.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(obj);
          combinedBox.union(box);
        }
      });

      let yShift = 0;
      if (combinedBox.min.y < bounds.minY) {
        yShift = bounds.minY - combinedBox.min.y;
      }

      if (yShift !== 0) {
        selectedIds.forEach((id) => {
          const obj = meshRefs.current.get(id);
          if (obj) {
            shiftObjectWorldY(obj, yShift);
          }
        });
      }

      return;
    }

    const shapeId = scaleDrag.current.shapeId;
    const obj = meshRefs.current.get(shapeId);
    const s = shapes.find((x) => x.id === shapeId);
    if (!obj || !s) return;

    const startScale = scaleDrag.current.startScale;
    const startPos = scaleDrag.current.startPosition;
    const baseSize = scaleDrag.current.startBaseSize || s.baseSize || [1, 1, 1];

    // Project world-space drag onto the handle's local axis direction
    const localAxis = new THREE.Vector3(
      dir.includes("x") ? 1 : 0,
      dir.includes("y") ? 1 : 0,
      dir.includes("z") ? 1 : 0,
    ).applyQuaternion(obj.quaternion);
    const worldDelta = hit.clone().sub(scaleDrag.current.startPt);
    const axisDelta =
      worldDelta.dot(localAxis) * (dir.startsWith("-") ? -1 : 1);

    let newScale = [...startScale] as [number, number, number];
    let localTranslation = new THREE.Vector3(0, 0, 0);
    const isShift = isShiftPressedRef.current;

    if (isShift) {
      let ratio = 1.0;
      if (dir.includes("x")) {
        ratio = (startScale[0] + axisDelta / baseSize[0]) / startScale[0];
      } else if (dir.includes("z")) {
        ratio = (startScale[2] + axisDelta / baseSize[2]) / startScale[2];
      } else if (dir.includes("y")) {
        ratio = (startScale[1] + axisDelta / baseSize[1]) / startScale[1];
      }

      ratio = Math.max(0.1 / Math.min(...startScale), ratio);
      newScale[0] = startScale[0] * ratio;
      newScale[1] = startScale[1] * ratio;
      newScale[2] = startScale[2] * ratio;

      if (scaleFromSide) {
        const actualWorldDeltaX = (newScale[0] - startScale[0]) * baseSize[0];
        localTranslation.x = dir.includes("-x")
          ? -actualWorldDeltaX / 2
          : actualWorldDeltaX / 2;
        const actualWorldDeltaY = (newScale[1] - startScale[1]) * baseSize[1];
        localTranslation.y = dir.includes("-y")
          ? -actualWorldDeltaY / 2
          : actualWorldDeltaY / 2;
        const actualWorldDeltaZ = (newScale[2] - startScale[2]) * baseSize[2];
        localTranslation.z = dir.includes("-z")
          ? -actualWorldDeltaZ / 2
          : actualWorldDeltaZ / 2;
      }
    } else {
      const deltaRatio =
        axisDelta /
        (dir.includes("x")
          ? baseSize[0]
          : dir.includes("y")
            ? baseSize[1]
            : baseSize[2]);

      if (dir.includes("x")) {
        newScale[0] = Math.max(0.1, startScale[0] + deltaRatio);
        if (scaleFromSide) {
          const actualWorldDelta = (newScale[0] - startScale[0]) * baseSize[0];
          localTranslation.x = dir.includes("-x")
            ? -actualWorldDelta / 2
            : actualWorldDelta / 2;
        }
      }
      if (dir.includes("y")) {
        newScale[1] = Math.max(0.1, startScale[1] + deltaRatio);
        if (scaleFromSide) {
          const actualWorldDelta = (newScale[1] - startScale[1]) * baseSize[1];
          localTranslation.y = dir.includes("-y")
            ? -actualWorldDelta / 2
            : actualWorldDelta / 2;
        }
      }
      if (dir.includes("z")) {
        newScale[2] = Math.max(0.1, startScale[2] + deltaRatio);
        if (scaleFromSide) {
          const actualWorldDelta = (newScale[2] - startScale[2]) * baseSize[2];
          localTranslation.z = dir.includes("-z")
            ? -actualWorldDelta / 2
            : actualWorldDelta / 2;
        }
      }
    }

    const worldTranslation = localTranslation.applyQuaternion(obj.quaternion);

    let finalPos = [
      startPos[0] + worldTranslation.x,
      startPos[1] + worldTranslation.y,
      startPos[2] + worldTranslation.z,
    ] as [number, number, number];

    if (snapToGrid) {
      newScale[0] = Math.round(newScale[0] / snapIncrement) * snapIncrement;
      newScale[1] = Math.round(newScale[1] / snapIncrement) * snapIncrement;
      newScale[2] = Math.round(newScale[2] / snapIncrement) * snapIncrement;

      finalPos[0] = Math.round(finalPos[0] / snapIncrement) * snapIncrement;
      finalPos[1] = Math.round(finalPos[1] / snapIncrement) * snapIncrement;
      finalPos[2] = Math.round(finalPos[2] / snapIncrement) * snapIncrement;
    }

    finalPos[0] = Math.max(bounds.minX, Math.min(bounds.maxX, finalPos[0]));
    finalPos[2] = Math.max(bounds.minZ, Math.min(bounds.maxZ, finalPos[2]));
    finalPos[1] = Math.max(bounds.minY, finalPos[1]);

    const scaleObj = obj.userData.scaleGroup || obj;
    scaleObj.scale.set(...newScale);
    obj.position.set(...finalPos);

    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    let diff = 0;
    if (box.min.y < bounds.minY) {
      diff = bounds.minY - box.min.y;
    }

    if (diff !== 0) {
      finalPos[1] += diff;
      obj.position.set(...finalPos);
      obj.updateMatrixWorld(true);
    }
  });

  const handleShapeDown = useCallback(
    (e: any, initialTargets: ShapeType[]) => {
      e.stopPropagation();

      const selectIndividual = e.ctrlKey || e.metaKey;

      const targetIds = new Set<number>();
      initialTargets.forEach((t) => {
        const isMotorGroupShape = motorGroups.some((mg) =>
          mg.shapeIds.includes(t.id),
        );
        if (t.parentId && !selectIndividual && !isMotorGroupShape) {
          shapesRef.current
            .filter(
              (s) =>
                s.parentId === t.parentId &&
                !motorGroups.some((mg) => mg.shapeIds.includes(s.id)),
            )
            .forEach((s) => targetIds.add(s.id));
        } else {
          targetIds.add(t.id);
        }
      });
      const ids = Array.from(targetIds);
      const targetShapes = shapesRef.current.filter((s) => targetIds.has(s.id));

      if (mode === "drawPath") {
        let currentPathId = selectedPathId;
        let workingPaths = paths;
        if (!currentPathId) {
          if (paths.length > 0) {
            currentPathId = paths[paths.length - 1].id;
            setSelectedPathId?.(currentPathId);
          } else {
            currentPathId = Date.now();
            workingPaths = [
              {
                id: currentPathId,
                name: "Path 1",
                points: [],
                closed: false,
              },
            ];
            setSelectedPathId?.(currentPathId);
          }
        }
        if (
          currentPathId &&
          !shapesRef.current.some((s) => s.pathId === currentPathId)
        ) {
          const pt = e.point;
          const newPaths = workingPaths.map((p) => {
            if (p.id !== currentPathId) return p;
            const newPts = [...p.points, [pt.x, pt.y, pt.z]] as [
              number,
              number,
              number,
            ][];
            setActivePathWP(newPts.length - 1);
            return { ...p, points: newPts };
          });
          savePathsToHistory(undefined, newPaths);
        }
        return;
      }

      if (e.shiftKey) {
        setSelectedIds((prev) => {
          const allIn = ids.every((id) => prev.includes(id));
          return allIn
            ? prev.filter((id) => !ids.includes(id))
            : Array.from(new Set([...prev, ...ids]));
        });
      } else {
        const clickedIsAlreadySelected = ids.some((id) =>
          selectedIds.includes(id),
        );

        if (clickedIsAlreadySelected) {
          setSelectedIds((prev) => prev);
          const existingSelectedShapes = shapesRef.current.filter((s) =>
            selectedIds.includes(s.id),
          );
          const dragShapes = isAtomicGroupSelection(existingSelectedShapes)
            ? existingSelectedShapes
            : existingSelectedShapes.filter((s) => !s.isLocked);
          startDrag(e, dragShapes.length ? dragShapes : targetShapes);
        } else {
          setSelectedIds(ids);
          startDrag(
            e,
            isAtomicGroupSelection(targetShapes)
              ? targetShapes
              : targetShapes.filter((s) => !s.isLocked),
          );
        }
      }
    },
    [
      selectedIds,
      startDrag,
      setSelectedIds,
      mode,
      selectedPathId,
      setSelectedPathId,
      paths,
      setPaths,
      setActivePathWP,
      savePathsToHistory,
      motorGroups,
    ],
  );

  const prevGroupsMapRef = useRef<Map<number, ShapeType[]>>(new Map());

  const groupsMap = useMemo(() => {
    const map = new Map<number, ShapeType[]>();
    shapes.forEach((s) => {
      if (s.parentId && !motorGroups.some((mg) => mg.shapeIds.includes(s.id))) {
        if (!map.has(s.parentId)) map.set(s.parentId, []);
        map.get(s.parentId)!.push(s);
      }
    });
    // Reuse the previous render's array reference for any group whose member
    // shapes are unchanged (same objects, same order). Editing one shape
    // (e.g. toggling isHole for a boolean add/subtract) only changes that
    // shape's object identity, not its groupmates' — without this, every
    // group's members array got a fresh identity on every edit, which busted
    // the CSGGroup React.memo below (members is a prop) and re-rendered
    // every boolean group in the scene instead of just the edited one.
    const prev = prevGroupsMapRef.current;
    map.forEach((members, gid) => {
      const prevMembers = prev.get(gid);
      if (
        prevMembers &&
        prevMembers.length === members.length &&
        prevMembers.every((m, i) => m === members[i])
      ) {
        map.set(gid, prevMembers);
      }
    });
    prevGroupsMapRef.current = map;
    return Array.from(map.entries());
  }, [shapes, motorGroups]);

  const membersByGroupId = useMemo(() => {
    const map = new Map<number, ShapeType[]>();
    groupsMap.forEach(([gid, members]) => map.set(gid, members));
    return map;
  }, [groupsMap]);

  const jointGroups = useMemo(() => {
    return groups.filter((g) => g.isJoint && membersByGroupId.has(g.id));
  }, [groups, membersByGroupId]);

  const jointChildrenByParent = useMemo(() => {
    const map = new Map<number, GroupType[]>();
    jointGroups.forEach((g) => {
      const pid = g.parentGroupId;
      if (pid == null || pid === g.id) return;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(g);
    });
    return map;
  }, [jointGroups]);

  const jointRootGroups = useMemo(() => {
    const jointIds = new Set(jointGroups.map((g) => g.id));
    return jointGroups.filter(
      (g) =>
        !g.parentGroupId ||
        g.parentGroupId === g.id ||
        !jointIds.has(g.parentGroupId),
    );
  }, [jointGroups]);

  return (
    <>
      {cameraType === "perspective" ? (
        <PerspectiveCamera
          makeDefault
          position={[50, 50, 50]}
          fov={50}
          near={0.01}
          far={20000}
        />
      ) : (
        <OrthographicCamera
          makeDefault
          position={[50, 50, 50]}
          zoom={12}
          near={0.01}
          far={20000}
        />
      )}
      <color
        attach="background"
        args={[wsSettings?.darkBackground ? "#1e293b" : "#ffffff"]}
      />
      <ambientLight intensity={1} />
      <directionalLight
        position={[30, 20, 10]}
        intensity={2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={
          Math.max(wsSettings?.presetWidth || 200, wsSettings?.presetLength || 200) * 1.5
        }
        shadow-camera-left={-(Math.max(wsSettings?.presetWidth || 200, wsSettings?.presetLength || 200) / 2 + 10)}
        shadow-camera-right={Math.max(wsSettings?.presetWidth || 200, wsSettings?.presetLength || 200) / 2 + 10}
        shadow-camera-top={Math.max(wsSettings?.presetWidth || 200, wsSettings?.presetLength || 200) / 2 + 10}
        shadow-camera-bottom={-(Math.max(wsSettings?.presetWidth || 200, wsSettings?.presetLength || 200) / 2 + 10)}
      />
      <WorkplaneSurface wsSettings={wsSettings} />
      {wsSettings?.showGrid !== false && (
        <Grid
          args={[
            Math.max(
              wsSettings?.presetWidth || 200,
              wsSettings?.presetLength || 200,
            ),
            Math.max(
              wsSettings?.presetWidth || 200,
              wsSettings?.presetLength || 200,
            ),
          ]}
          cellSize={1}
          sectionSize={10}
          cellThickness={0.4}
          sectionThickness={1.0}
          sectionColor="#7dd3fc"
          cellColor="#bae6fd"
          fadeDistance={
            Math.max(
              wsSettings?.presetWidth || 200,
              wsSettings?.presetLength || 200,
            ) * 1.5
          }
          fadeStrength={1}
          infiniteGrid={false}
        />
      )}
      {wsSettings?.showShadows !== false && (
        <ContactShadows
          position={[0, -0.1, 0]}
          opacity={0.08}
          scale={gridSize}
          far={300}
        />
      )}
      <OrbitControls
        ref={orbitControlsRef}
        makeDefault
        enabled={!isBusy}
        // Lock only blocks rotate/pan — zoom (scroll wheel, pinch, and the
        // Zoom In/Out toolbar buttons, which bypass OrbitControls entirely
        // the same way the ViewCube does) stays available while locked, so
        // the user can still frame the view without unlocking.
        enableRotate={!cameraLocked}
        enablePan={!cameraLocked}
        dampingFactor={0.1}
        minDistance={5}
        maxDistance={1000}
        minZoom={0.1}
        maxZoom={2}
        zoomSpeed={wsSettings ? wsSettings.zoomSpeed / 50 : 1.2}
      />
      <GizmoHelper alignment="bottom-left" margin={[60, 60]}>
        <CleanAxisMap />
      </GizmoHelper>
      <BoundaryWalls wsSettings={wsSettings} />

      {showPaths &&
        paths.map((p) => (
          <PathRenderer
            key={`path-${p.id}`}
            path={p}
            paths={paths}
            isSelected={selectedPathId === p.id || selectedPathIds.includes(p.id)}
            isAttached={shapes.some((s) => s.pathId === p.id)}
            savePathsToHistory={(nps) => savePathsToHistory(undefined, nps)}
            setPaths={setPaths}
            // The per-point drag gizmo only belongs in path mode. Gating the
            // prop (rather than clearing the state) hides the gizmo the moment
            // you leave "drawPath" and brings it back on the same point when
            // you return, without a stale <TransformControls> stuck in the
            // scene in translate/rotate/scale mode.
            activePathWP={mode === "drawPath" ? activePathWP : null}
            setActivePathWP={setActivePathWP}
          />
        ))}

      {showPaths && mode === "drawPath" && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, drawingAltitude, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            let currentPathId = selectedPathId;
            let workingPaths = paths;
            if (!currentPathId) {
              if (paths.length > 0) {
                currentPathId = paths[paths.length - 1].id;
                setSelectedPathId?.(currentPathId);
              } else {
                currentPathId = Date.now();
                workingPaths = [
                  {
                    id: currentPathId,
                    name: "Path 1",
                    points: [],
                    closed: false,
                  },
                ];
                setSelectedPathId?.(currentPathId);
              }
            }
            if (
              currentPathId &&
              !shapes.some((s) => s.pathId === currentPathId)
            ) {
              const pt = e.point;
              const newPaths = workingPaths.map((p) => {
                if (p.id !== currentPathId) return p;
                const newPts = [...p.points, [pt.x, drawingAltitude, pt.z]] as [
                  number,
                  number,
                  number,
                ][];
                setActivePathWP(newPts.length - 1);
                return { ...p, points: newPts };
              });
              savePathsToHistory(undefined, newPaths);
            }
          }}
        >
          <planeGeometry args={[gridSize, gridSize]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
          />
          <gridHelper
            args={[
              Math.max(
                wsSettings?.presetWidth || 200,
                wsSettings?.presetLength || 200,
              ),
              Math.max(
                wsSettings?.presetWidth || 200,
                wsSettings?.presetLength || 200,
              ),
              "#38bdf8",
              "#7dd3fc",
            ]}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0.01, 0]}
          />
        </mesh>
      )}

      <group ref={exportGroupRef as any}>
        {shapes
          .filter(
            (s) =>
              (!s.parentId ||
                motorGroups.some((mg) => mg.shapeIds.includes(s.id))) &&
              s.grabbedBy === undefined,
          )
          .map((shape) => (
            <KinematicNode
              key={shape.id}
              shape={shape}
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
              updateBaseSize={updateBaseSize}
            />
          ))}

        {groupsMap
          .filter(([groupId]) => !jointGroups.some((g) => g.id === groupId))
          .map(([groupId, allMembers]) => {
            const members = allMembers;
            if (members.length === 0) return null;

            const groupSelected = members.every((m: ShapeType) =>
              selectedIds.includes(m.id),
            );
            const wrapWithJointPivot = (content: React.ReactNode) =>
              content as any;

            if (
              groupSelected &&
              mode !== "translate" &&
              mode !== "rotate" &&
              mode !== "drawPath" &&
              !members.some((m: ShapeType) => m.isLocked)
            ) {
              const groupObj = groups.find((g) => g.id === groupId);
              const center = new THREE.Vector3();
              if (groupObj && groupObj.pivotShapeId !== undefined) {
                const pShape = members.find(
                  (m: ShapeType) => m.id === groupObj.pivotShapeId,
                );
                if (pShape) {
                  center.set(
                    pShape.position[0],
                    pShape.position[1],
                    pShape.position[2],
                  );
                } else if (groupObj.pivot) {
                  center.set(
                    groupObj.pivot[0],
                    groupObj.pivot[1],
                    groupObj.pivot[2],
                  );
                } else {
                  const box = new THREE.Box3();
                  members.forEach((m: ShapeType) => {
                    box.union(
                      new THREE.Box3().setFromCenterAndSize(
                        new THREE.Vector3(...m.position),
                        new THREE.Vector3(...m.scale),
                      ),
                    );
                  });
                  box.getCenter(center);
                }
              } else if (groupObj && groupObj.pivot) {
                center.set(
                  groupObj.pivot[0],
                  groupObj.pivot[1],
                  groupObj.pivot[2],
                );
              } else {
                const box = new THREE.Box3();
                members.forEach((m: ShapeType) => {
                  box.union(
                    new THREE.Box3().setFromCenterAndSize(
                      new THREE.Vector3(...m.position),
                      new THREE.Vector3(...m.scale),
                    ),
                  );
                });
                box.getCenter(center);
              }

              const tc = (
                <TransformControls
                  key={`tc-group-${groupId}`}
                  mode={mode as any}
                  position={[center.x, center.y, center.z]}
                  onMouseDown={() => setIsBusy(true)}
                  onMouseUp={(e: any) => {
                    setIsBusy(false);
                    if (!e?.target?.object) return;
                    const transformGroup = e.target.object as THREE.Group;

                    transformGroup.updateMatrixWorld(true);
                    const groupBox = new THREE.Box3().setFromObject(
                      transformGroup,
                    );
                    let yShift = 0;
                    if (groupBox.min.y < bounds.minY) {
                      yShift = bounds.minY - groupBox.min.y;
                    }

                    const newShapes = shapes.map((s) => {
                      const member = members.find(
                        (m: ShapeType) => m.id === s.id,
                      );
                      if (!member) return s;

                      let obj: THREE.Object3D | undefined;
                      transformGroup.traverse((c: any) => {
                        if (!obj && c?.userData?.shapeId === s.id && !c?.userData?.isCSGMesh) obj = c;
                      });
                      if (!obj) return s;

                      const worldPos = new THREE.Vector3();
                      const worldQuat = new THREE.Quaternion();
                      const worldScale = new THREE.Vector3();
                      obj.getWorldPosition(worldPos);
                      obj.getWorldQuaternion(worldQuat);
                      obj.getWorldScale(worldScale);

                      const euler = new THREE.Euler().setFromQuaternion(
                        worldQuat,
                      );

                      let newPos = [
                        worldPos.x,
                        worldPos.y + yShift,
                        worldPos.z,
                      ] as [number, number, number];

                      newPos[0] = Math.max(
                        bounds.minX,
                        Math.min(bounds.maxX, newPos[0]),
                      );
                      newPos[2] = Math.max(
                        bounds.minZ,
                        Math.min(bounds.maxZ, newPos[2]),
                      );

                      return {
                        ...s,
                        position: newPos,
                        rotation: [euler.x, euler.y, euler.z] as [
                          number,
                          number,
                          number,
                        ],
                        scale: [
                          Math.max(0.1, worldScale.x),
                          Math.max(0.1, worldScale.y),
                          Math.max(0.1, worldScale.z),
                        ] as [number, number, number],
                      };
                    });
                    savePathsToHistory(newShapes);
                  }}
                >
                  {wrapWithJointPivot(
                    (() => {
                      const hasHoles = members.some((m) => m.isHole);
                      return (
                        <group position={[-center.x, -center.y, -center.z]}>
                          {hasHoles && (
                            <CSGGroup
                              members={members}
                              selectedIds={selectedIds}
                              evaluator={evaluator}
                              onPointerDown={() => {}}
                              simulationFrame={simulationFrame}
                              gltfGeometryMap={gltfGeometryMap}
                              meshRefs={meshRefs}
                              updateBaseSize={updateBaseSize}
                            />
                          )}
                          {members.map((m: ShapeType) => {
                            const visible = !hasHoles;
                            if (m.type === "glb" && m.url) {
                              return (
                                <SuspendedGlbShapeMesh
                                  key={`group-member-${m.id}`}
                                  position={m.position}
                                  rotation={m.rotation}
                                  scale={m.scale}
                                  userData={{ shapeId: m.id }}
                                  shape={m}
                                  simulationFrame={simulationFrame}
                                  isSelected={false}
                                  onLoaded={(
                                    baseSize: [number, number, number],
                                  ) => updateBaseSize(m.id, baseSize)}
                                  castShadow={!m.isHole}
                                  receiveShadow={!m.isHole}
                                  visible={visible}
                                />
                              );
                            }
                             if (m.type === "custom" && m.customMembers) {
                              return (
                                <CustomShapeMesh
                                  key={`group-member-${m.id}`}
                                  position={m.position}
                                  rotation={m.rotation}
                                  scale={m.scale}
                                  userData={{ shapeId: m.id }}
                                  shape={m}
                                  evaluator={evaluator}
                                  simulationFrame={simulationFrame}
                                  isSelected={false}
                                  gltfGeometryMap={gltfGeometryMap}
                                  castShadow={!m.isHole}
                                  receiveShadow={!m.isHole}
                                  visible={visible}
                                  onLoaded={(baseSize: [number, number, number]) =>
                                    updateBaseSize(m.id, baseSize)
                                  }
                                />
                              );
                            }
                            return (
                              <mesh
                                key={`group-member-${m.id}`}
                                position={m.position}
                                rotation={m.rotation}
                                scale={m.scale}
                                userData={{ shapeId: m.id }}
                                castShadow={!m.isHole}
                                receiveShadow={!m.isHole}
                                visible={visible}
                              >
                                <PrimitiveGeometry type={m.type} />
                                <ShapeMaterial
                                  shape={m}
                                  simulationData={simulationFrame}
                                />
                              </mesh>
                            );
                          })}
                        </group>
                      );
                    })(),
                  )}
                </TransformControls>
              );

              const path = paths.find((p) => p.id === members[0].pathId);
              return path ? (
                <AnimatedWrapper shape={members[0]} path={path}>
                  {tc}
                </AnimatedWrapper>
              ) : (
                tc
              );
            }

            const entireGroupSelected = members.every((m: ShapeType) =>
              selectedIds.includes(m.id),
            );
            const isBooleanGroup = members.some(
              (m: ShapeType) => m.groupType === "boolean",
            );
            return (
              <group
                key={groupId}
                ref={(el) => {
                  if (el) {
                    // Always mark the group element so individual members can
                    // find it via meshRefs regardless of selection state.
                    // isCSGGroup = true makes the drag system move the whole
                    // group atomically (only when fully selected or boolean).
                    if (entireGroupSelected || isBooleanGroup) {
                      el.userData.isCSGGroup = true;
                      members.forEach((m: ShapeType) => {
                        meshRefs.current.set(m.id, el);
                      });
                    } else {
                      // For partial selection: do NOT set isCSGGroup, but
                      // ensure any previously set stale refs are cleared so
                      // individual KinematicNode refs take precedence.
                      el.userData.isCSGGroup = false;
                    }
                  }
                }}
              >
                {(() => {
                  const content = (
                    <CSGGroup
                      members={members}
                      selectedIds={selectedIds}
                      evaluator={evaluator}
                      onPointerDown={handleShapeDown}
                      simulationFrame={simulationFrame}
                      gltfGeometryMap={gltfGeometryMap}
                      meshRefs={meshRefs}
                      updateBaseSize={updateBaseSize}
                    />
                  );
                  const path = paths.find((p) => p.id === members[0].pathId);
                  const maybeJointed = wrapWithJointPivot(content);
                  return path ? (
                    <AnimatedWrapper shape={members[0]} path={path}>
                      {maybeJointed}
                    </AnimatedWrapper>
                  ) : (
                    maybeJointed
                  );
                })()}
              </group>
            );
          })}

        {jointRootGroups.map((root) => {
          const renderJointNode = (g: GroupType): React.ReactNode => {
            const members = membersByGroupId.get(g.id) || [];
            if (members.length === 0) return null;
            const groupSelected = members.every((m: ShapeType) =>
              selectedIds.includes(m.id),
            );
            let pivot: [number, number, number] = [0, 0, 0];
            if (g.pivotShapeId !== undefined) {
              const pivotShape = members.find(
                (m: ShapeType) => m.id === g.pivotShapeId,
              );
              if (pivotShape) {
                pivot = [
                  pivotShape.position[0],
                  pivotShape.position[1],
                  pivotShape.position[2],
                ];
              } else if (g.pivot) {
                pivot = [g.pivot[0], g.pivot[1], g.pivot[2]];
              } else {
                members.forEach((m: ShapeType) => {
                  pivot[0] += m.position[0];
                  pivot[1] += m.position[1];
                  pivot[2] += m.position[2];
                });
                pivot[0] /= members.length || 1;
                pivot[1] /= members.length || 1;
                pivot[2] /= members.length || 1;
              }
            } else if (g.pivot) {
              pivot = [g.pivot[0], g.pivot[1], g.pivot[2]];
            } else {
              members.forEach((m: ShapeType) => {
                pivot[0] += m.position[0];
                pivot[1] += m.position[1];
                pivot[2] += m.position[2];
              });
              pivot[0] /= members.length || 1;
              pivot[1] /= members.length || 1;
              pivot[2] /= members.length || 1;
            }
            const axis = g.jointAxis || "y";
            const rotDeg = g.jointRotation || 0;
            const rot: [number, number, number] =
              axis === "x"
                ? [THREE.MathUtils.degToRad(rotDeg), 0, 0]
                : axis === "z"
                  ? [0, 0, THREE.MathUtils.degToRad(rotDeg)]
                  : [0, THREE.MathUtils.degToRad(rotDeg), 0];

            const groupContent = (() => {
              if (
                groupSelected &&
                mode !== "translate" &&
                mode !== "rotate" &&
                mode !== "drawPath" &&
                !members.some((m: ShapeType) => m.isLocked)
              ) {
                const center = new THREE.Vector3(pivot[0], pivot[1], pivot[2]);
                return (
                  <TransformControls
                    key={`tc-joint-group-${g.id}`}
                    mode={mode as any}
                    position={[center.x, center.y, center.z]}
                    onMouseDown={() => setIsBusy(true)}
                    onMouseUp={(e: any) => {
                      setIsBusy(false);
                      if (!e?.target?.object) return;
                      const transformGroup = e.target.object as THREE.Group;

                      transformGroup.updateMatrixWorld(true);
                      const groupBox = new THREE.Box3().setFromObject(
                        transformGroup,
                      );
                      let yShift = 0;
                      if (groupBox.min.y < bounds.minY) {
                        yShift = bounds.minY - groupBox.min.y;
                      }

                      const newShapes = shapes.map((s) => {
                        const member = members.find(
                          (m: ShapeType) => m.id === s.id,
                        );
                        if (!member) return s;
                        let obj: THREE.Object3D | undefined;
                        transformGroup.traverse((c: any) => {
                          if (!obj && c?.userData?.shapeId === s.id && !c?.userData?.isCSGMesh) obj = c;
                        });
                        if (!obj) return s;
                        const worldPos = new THREE.Vector3();
                        const worldQuat = new THREE.Quaternion();
                        const worldScale = new THREE.Vector3();
                        obj.getWorldPosition(worldPos);
                        obj.getWorldQuaternion(worldQuat);
                        obj.getWorldScale(worldScale);
                        const euler = new THREE.Euler().setFromQuaternion(
                          worldQuat,
                        );

                        let newPos = [
                          worldPos.x,
                          worldPos.y + yShift,
                          worldPos.z,
                        ];
                        newPos[0] = Math.max(
                          bounds.minX,
                          Math.min(bounds.maxX, newPos[0]),
                        );
                        newPos[2] = Math.max(
                          bounds.minZ,
                          Math.min(bounds.maxZ, newPos[2]),
                        );

                        return {
                          ...s,
                          position: newPos,
                          rotation: [euler.x, euler.y, euler.z],
                          scale: [
                            Math.max(0.1, worldScale.x),
                            Math.max(0.1, worldScale.y),
                            Math.max(0.1, worldScale.z),
                          ],
                        } as any;
                      });
                      savePathsToHistory(newShapes);
                    }}
                  >
                    <group position={[-center.x, -center.y, -center.z]}>
                      {members.map((m: ShapeType) => {
                        if (m.type === "glb" && m.url) {
                          return (
                            <SuspendedGlbShapeMesh
                              key={`joint-member-${m.id}`}
                              position={m.position}
                              rotation={m.rotation}
                              scale={m.scale}
                              userData={{ shapeId: m.id }}
                              shape={m}
                              simulationFrame={null}
                              isSelected={false}
                              onLoaded={(baseSize: [number, number, number]) =>
                                updateBaseSize(m.id, baseSize)
                              }
                              castShadow={!m.isHole}
                              receiveShadow={!m.isHole}
                            />
                          );
                        }
                        if (m.type === "custom" && m.customMembers) {
                          return (
                            <CustomShapeMesh
                              key={`joint-member-${m.id}`}
                              position={m.position}
                              rotation={m.rotation}
                              scale={m.scale}
                              userData={{ shapeId: m.id }}
                              shape={m}
                              evaluator={evaluator}
                              simulationFrame={null}
                              isSelected={false}
                              gltfGeometryMap={gltfGeometryMap}
                              castShadow={!m.isHole}
                              receiveShadow={!m.isHole}
                              onLoaded={(baseSize: [number, number, number]) =>
                                updateBaseSize(m.id, baseSize)
                              }
                            />
                          );
                        }
                        return (
                          <mesh
                            key={`joint-member-${m.id}`}
                            position={m.position}
                            rotation={m.rotation}
                            scale={m.scale}
                            userData={{ shapeId: m.id }}
                            castShadow={!m.isHole}
                            receiveShadow={!m.isHole}
                          >
                            <PrimitiveGeometry type={m.type} />
                            <ShapeMaterial shape={m} simulationData={undefined} />
                          </mesh>
                        );
                      })}
                    </group>
                  </TransformControls>
                );
              }

              const entireGroupSelected = members.every((m: ShapeType) =>
                selectedIds.includes(m.id),
              );
              const isBooleanGroup = members.some(
                (m: ShapeType) => m.groupType === "boolean",
              );
              return (
                <group
                  key={g.id}
                  ref={(el) => {
                    if (el) {
                      members.forEach((m: ShapeType) => {
                        if (entireGroupSelected || isBooleanGroup) {
                          el.userData.isCSGGroup = true;
                          meshRefs.current.set(m.id, el);
                        }
                      });
                    }
                  }}
                >
                  <CSGGroup
                    members={members}
                    selectedIds={selectedIds}
                    evaluator={evaluator}
                    onPointerDown={handleShapeDown}
                    simulationFrame={simulationFrame}
                    gltfGeometryMap={gltfGeometryMap}
                    meshRefs={meshRefs}
                    updateBaseSize={updateBaseSize}
                  />
                </group>
              );
            })();

            const children = jointChildrenByParent.get(g.id) || [];
            return (
              <group key={`joint-node-${g.id}`} position={pivot}>
                <JointMotionGroup
                  group={g}
                  fallbackRotation={rot}
                  motionController={motionController}
                  shapes={shapes}
                  groups={groups}
                  meshRefs={meshRefs}
                >
                  <group position={[-pivot[0], -pivot[1], -pivot[2]]}>
                    {groupContent}
                    {children.map((c) => renderJointNode(c))}
                  </group>
                </JointMotionGroup>
              </group>
            );
          };

          return (
            <React.Fragment key={`joint-root-${root.id}`}>
              {renderJointNode(root)}
            </React.Fragment>
          );
        })}
      </group>

      {mode === "erase" && erasePreview && (
        <mesh position={erasePreview.point} name="erase-brush-preview">
          {brushShape === "cube" ? (
            <boxGeometry
              args={[brushSize ?? 1.0, brushSize ?? 1.0, brushSize ?? 1.0]}
            />
          ) : (
            <sphereGeometry args={[(brushSize ?? 1.0) / 2, 32, 32]} />
          )}
          <meshBasicMaterial
            color="#ef4444"
            transparent
            opacity={0.35}
            depthWrite={false}
          />
          <Edges color="#ef4444" />
        </mesh>
      )}

      {mode === "scale" && selectedIds.length > 1 && (
        <UnifiedScaleGizmo
          selectedIds={selectedIds}
          shapes={shapes}
          meshRefs={meshRefs}
          startScaleDrag={startScaleDrag}
        />
      )}
    </>
  );
}
