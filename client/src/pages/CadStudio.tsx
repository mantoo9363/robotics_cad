/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import Canvas3D from "../components/Canvas3D";
import type { DropPayload } from "../components/canvas/DropPlacement";
import RightPanel from "../components/RightPanel";
import "../App.css";
import type {
  CircuitLinkOption,
  CircuitStreamFrame,
  CircuitStreamStartPayload,
} from "../lib/circuitStream";
import { mergeCircuitLinkOptionsFromFrame } from "../lib/circuitStream";
import { MotionController } from "../lib/motionController";
import { getShapeBaseSize } from "../lib/shapeDimensions";
import type { WorkspaceSettings } from "../types/workspace";
import { loadWsSettings, saveWsSettings } from "../types/workspace";
import { useNavigate } from "react-router-dom";
import WorkspaceSettingsModal from "../components/canvas/WorkspaceSettingsModal";
import { InspectorSection } from "../components/right-panel/InspectorSection";
import { MotionControlSection } from "../components/right-panel/MotionControlSection";
import { CircuitSection } from "../components/right-panel/CircuitSection";
import { CAD_STREAM_URL, getSimulationServerLabel } from "../lib/env";
import {
  Copy,
  Clipboard,
  CopyPlus,
  Trash2,
  Undo2,
  Redo2,
  Layers,
  Ungroup,
  Scissors,
  Upload,
  Play,
  Sparkles,
  Move,
  RotateCw,
  Maximize2,
  PenTool,
  Eraser,
  Edit,
} from "lucide-react";

export type TransformMode =
  | "translate"
  | "rotate"
  | "scale"
  | "drawPath"
  | "erase";

export type MotionType = "motor" | "xyz_rotation" | "linear";

export type PathPoint = [number, number, number];

export type MotionPath = {
  id: number;
  name?: string;
  points: PathPoint[];
  closed: boolean;
};

export type GroupType = {
  id: number;
  name?: string;
  /** Parent group id (for joint chaining). */
  parentGroupId?: number;
  isJoint?: boolean;
  jointAxis?: "x" | "y" | "z";
  jointRotation?: number; // degrees
  /** Optional explicit pivot in world coordinates. If missing, renderer can derive from members. */
  pivot?: [number, number, number];
  pivotShapeId?: number;
  motionChannelId?: string;
  motionType?: "motor" | "xyz_rotation" | "linear";
  motionInverted?: boolean;
};

export type MotorGroup = {
  id: number;
  name?: string;
  shapeIds: number[]; // IDs of shapes this motor controls
  motionChannelId?: string;
  motionType?: "motor" | "xyz_rotation" | "linear";
  motionInverted?: boolean;
  /** Optional pivot point for rotation motors (world coordinates) */
  pivot?: [number, number, number];
  /** Rotation axis for motor type */
  jointAxis?: "x" | "y" | "z";
  /** Shape whose position is used as rotation pivot */
  pivotShapeId?: number;
  minLimit?: number;
  maxLimit?: number;
  vehicleRole?: "drive" | "steer" | "none";
};

export type JointCommand = {
  jointId: number;
  angleDeg: number;
};

export type CustomAsset = {
  id: string;
  name: string;
  url: string;
};

export type CustomMember = {
  type:
    | "cube"
    | "sphere"
    | "cylinder"
    | "cone"
    | "torus"
    | "hexagon"
    | "cogwheel"
    | "cogwheel-6t"
    | "cogwheel-8t"
    | "cogwheel-12t"
    | "cogwheel-16t"
    | "glb"
    | "custom";
  url?: string;
  offset: [number, number, number]; // relative to anchor
  rotation: [number, number, number];
  scale: [number, number, number];
  isHole: boolean;
  color?: string;
  customMembers?: CustomMember[];
  baseSize?: [number, number, number];
};

export type ShapeType = {
  id: number;
  name?: string;
  type:
    | "cube"
    | "sphere"
    | "cylinder"
    | "cone"
    | "torus"
    | "hexagon"
    | "cogwheel"
    | "cogwheel-6t"
    | "cogwheel-8t"
    | "cogwheel-12t"
    | "cogwheel-16t"
    | "group"
    | "custom"
    | "glb";
  scale: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  texturePath?: string; // For texture mapping
  url?: string; // For glb

  /** When set, live simulation from Circuit Studio maps `components[nodeId]` onto this shape. */
  circuitNodeId?: string;
  isLocked?: boolean;
  isHole?: boolean;
  preHoleColor?: string;
  parentId?: number;
  // NOTE: group-joint metadata lives on `groups` (Option 2).
  customMembers?: CustomMember[]; // for "custom" type (baked CSG result)
  pathId?: number; // ID of the motion pathx
  pathSpeed?: number; // Normalized speed modifier (defaults to 1.0)
  baseSize?: [number, number, number]; // Base dimensions of the geometry

  // Signal-driven motion
  motionChannelId?: string;
  motionType?: "motor" | "xyz_rotation" | "linear";
  motionInverted?: boolean;
  motionLimits?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  groupType?: "standard" | "boolean";

  // Legacy per-shape joint fields used by the older KinematicNode renderer.
  jointParentId?: number;
  jointPivot?: [number, number, number];
  jointAxis?: "x" | "y" | "z" | "xyz";
  jointAngle?: number;
  isJointAnimated?: boolean;
  jointRotation?: [number, number, number];

  // Grabbing System
  isGripper?: boolean;
  isGripping?: boolean;
  grabbable?: boolean;
  grabbedBy?: number;
  gripOffset?: [number, number, number];

  // Physics Properties
  friction?: number;
  restitution?: number;
  fixedRotation?: boolean;
  mass?: number;
  collisionDisabled?: boolean;
};

const STORAGE_KEY = "cad-studio-state";
const PATHS_KEY = "cad-studio-paths";
const ASSETS_KEY = "cad-studio-assets";
const SIMULATION_SERVER_LABEL = getSimulationServerLabel();

// Monotonic id generator for shapes/groups created at runtime (paste,
// duplicate, group, etc).
//
// The previous scheme, `Date.now() + runtimeIdCounter / 1e6`, was a
// collision generator, not a guard against one: float64 has ~15-17
// significant decimal digits, Date.now() already spends 13 of them, leaving
// no room to represent a 6th decimal place — `Date.now() + 0.000001` rounds
// straight back down to `Date.now()`. Every call within the same
// millisecond (which is the common case: duplicateShape()/handlePaste()
// call this in a tight forEach loop over multiple selected shapes) returned
// the exact same id. Two shapes sharing an id break every `shapes.find(s =>
// s.id === id)` lookup that follows — moving one can silently corrupt or
// hide the other, since they're indistinguishable by id.
//
// Scaling by 1000 first makes room for an exact (lossless) integer counter
// instead of a fractional one — up to 1000 guaranteed-unique ids per
// millisecond, still well under Number.MAX_SAFE_INTEGER.
let runtimeIdCounter = 0;
const generateRuntimeId = (): number => {
  runtimeIdCounter += 1;
  return Date.now() * 1000 + (runtimeIdCounter % 1000);
};

export type { CircuitLinkOption } from "../lib/circuitStream";

type AppState = {
  shapes: ShapeType[];
  paths: MotionPath[];
  groups: GroupType[];
  motorGroups: MotorGroup[];
};

function getCircuitComponentType(
  nodeId: string,
  frame: CircuitStreamFrame | null,
  options: CircuitLinkOption[],
  startPayload: CircuitStreamStartPayload | null,
) {
  const trimmed = nodeId.trim();
  if (!trimmed) return "";
  return (
    frame?.components?.[trimmed]?.componentType ||
    options.find((option) => option.id === trimmed)?.componentType ||
    startPayload?.nodes?.find((node) => node.id === trimmed)?.data
      ?.componentType ||
    ""
  );
}

function getServoAngle(
  component: NonNullable<CircuitStreamFrame["components"]>[string],
) {
  const angle = component.telemetry?.angle;
  return typeof angle === "number" ? angle : null;
}

function getMotorDegreesPerSecond(
  component: NonNullable<CircuitStreamFrame["components"]>[string],
) {
  const rpm =
    typeof component.telemetry?.rpm === "number"
      ? Math.abs(component.telemetry.rpm)
      : 0;
  const brightness =
    typeof component.brightness === "number" ? component.brightness : 0;
  const voltage =
    typeof component.voltage === "number" ? Math.abs(component.voltage) : 0;
  const active =
    component.isPowered || brightness > 0.01 || voltage > 0.05 || rpm > 0;
  if (!active) return 0;
  const base =
    rpm > 0
      ? rpm * 6
      : 180 + Math.max(brightness, Math.min(1, voltage / 9)) * 540;
  const direction =
    String(component.telemetry?.direction ?? "forward").toLowerCase() ===
    "reverse"
      ? -1
      : 1;
  return base * direction;
}

// DEV-only test hook — see the useEffect that assigns this, near
// updateColor() below, for why it exists (same convention as
// SimulationScene.tsx's window.__vehicleProbe).
declare global {
  interface Window {
    __csgTestRecolor?: (id: number, color: string) => void;
  }
}

function CadStudio() {
  const motionController = useRef(new MotionController());
  const motorRuntimeRef = useRef(
    new Map<string, { angle: number; timestamp: number }>(),
  );
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState("Fabulous Wluff-Tumelo");
  const [isEditingName, setIsEditingName] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [copiedShapes, setCopiedShapes] = useState<ShapeType[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    shapes: ShapeType[];
    paths: MotionPath[];
    groups: GroupType[];
    motorGroups: MotorGroup[];
    projectName?: string;
  } | null>(null);

  const [enableCircuitLink, setEnableCircuitLink] = useState(false);
  const [enableMotionControls, setEnableMotionControls] = useState(false);

  const handleCopy = () => {
    if (selectedIds.length === 0) return;
    const selected = selectedIds
      .map((id) => shapes.find((s) => s.id === id))
      .filter((s): s is ShapeType => !!s);
    setCopiedShapes(JSON.parse(JSON.stringify(selected)));
  };

  const handlePaste = () => {
    if (copiedShapes.length === 0) return;
    const newShapes: ShapeType[] = [];
    const newIds: number[] = [];
    copiedShapes.forEach((s) => {
      const nid = generateRuntimeId();
      newIds.push(nid);
      newShapes.push({
        ...s,
        id: nid,
        isLocked: false,
        position: [s.position[0] + 1, s.position[1], s.position[2] + 1],
      });
    });
    saveToHistory([...shapes, ...newShapes]);
    setSelectedIds(newIds);
  };

  const triggerImport = () => {
    importInputRef.current?.click();
  };

  const [shapes, setShapes] = useState<ShapeType[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const shapesOnly = Array.isArray(parsed) ? parsed : parsed?.shapes;
        if (!Array.isArray(shapesOnly)) return [];
        const filtered = shapesOnly.filter(
          (s: any) => !(s.type === "glb" && s.url?.startsWith("blob:")),
        );
        // Guard against generateRuntimeId's now-fixed float64 bug (see its
        // own comment): a project saved before that fix can still have two
        // shapes sharing an id from a past duplicate/paste/group action.
        // Shape lists render keyed by `id`, so a collision breaks
        // select/delete for one of the pair and can leave a stale render
        // behind with nothing in state to match it — an unselectable
        // "ghost" shape that outlives a delete. Reassign a fresh id to
        // every duplicate past the first occurrence, once, on load.
        return filtered.map((s: any, i: number) => {
          const firstIndex = filtered.findIndex((other: any) => other.id === s.id);
          return firstIndex === i ? s : { ...s, id: generateRuntimeId() };
        });
      } catch (e) {
        console.error("Failed to parse shapes from localStorage", e);
      }
    }
    return [];
  });

  const [groups, setGroups] = useState<GroupType[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const maybeGroups = Array.isArray(parsed) ? undefined : parsed?.groups;
        if (Array.isArray(maybeGroups)) return maybeGroups;
      } catch {
        // ignore
      }
    }
    // Backfill groups from any existing parentId usage
    try {
      const savedShapes = localStorage.getItem(STORAGE_KEY);
      if (savedShapes) {
        const parsed = JSON.parse(savedShapes);
        const shapesOnly = Array.isArray(parsed) ? parsed : parsed?.shapes;
        if (Array.isArray(shapesOnly)) {
          const ids = Array.from(
            new Set(
              shapesOnly
                .map((s: any) => s.parentId)
                .filter((x: any) => typeof x === "number"),
            ),
          ) as number[];
          return ids.map((id) => ({
            id,
            isJoint: false,
            jointAxis: "y",
            jointRotation: 0,
          }));
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [motorGroups, setMotorGroups] = useState<MotorGroup[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const maybeMotorGroups = Array.isArray(parsed)
          ? undefined
          : parsed?.motorGroups;
        if (Array.isArray(maybeMotorGroups)) return maybeMotorGroups;
      } catch {
        // ignore
      }
    }
    return [];
  });

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mode, setMode] = useState<TransformMode>("translate");
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [snapIncrement, setSnapIncrement] = useState<number>(0.1);
  // Fixed values (no setter is ever called) — passed straight through to Canvas3D.
  const gridSize = 100;
  const scaleFromSide = true;
  const [brushSize, setBrushSize] = useState<number>(1.0);
  const [csgError, setCsgError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showDemoCarConfirm, setShowDemoCarConfirm] = useState<boolean>(false);
  const [isEditingPathName, setIsEditingPathName] = useState<boolean>(false);

  useEffect(() => {
    const handleCsgError = (e: any) => {
      setCsgError(e.detail);
    };
    window.addEventListener("csg-error", handleCsgError);
    return () => window.removeEventListener("csg-error", handleCsgError);
  }, []);

  useEffect(() => {
    if (!csgError) return;
    const timer = setTimeout(() => setCsgError(null), 4000);
    return () => clearTimeout(timer);
  }, [csgError]);

  useEffect(() => {
    // Trailing slash trimmed so `${BASE_URL}${model.filePath}` (filePath starts
    // with "/uploads/...") doesn't double up: "/cad" + "/uploads/x" = "/cad/uploads/x".
    const BASE_URL = "/cad-assets/".replace(/\/$/, "");

    const handleModelDeleted = (model: {
      name: string;
      format: string;
      filePath?: string;
    }) => {
      const modelUrl = model.filePath
        ? `${BASE_URL}${model.filePath}`
        : `${BASE_URL}/uploads/${encodeURIComponent(model.name)}${model.format}`;

      setShapes((prev) => {
        const next = prev.filter((s) => s.url !== modelUrl);
        if (next.length !== prev.length) {
          const remainingIds = new Set(next.map((s) => s.id));
          setSelectedIds((ids) => ids.filter((id) => remainingIds.has(id)));
        }
        return next;
      });

      // The model is now gone from the catalog too (its thumbnail unmounts),
      // so nothing references this URL any more. Drop drei's cached GLTF —
      // decoded geometry + textures that otherwise stay resident (on the GPU
      // once drawn) for the rest of the session. A large model deleted from
      // the library was retaining tens of MB with no way to reclaim it.
      useGLTF.clear(modelUrl);
    };

    const onModelDeleted = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      handleModelDeleted(detail);
    };

    window.addEventListener("modelDeleted", onModelDeleted);
    return () => {
      window.removeEventListener("modelDeleted", onModelDeleted);
    };
  }, []);
  const [brushShape, setBrushShape] = useState<"sphere" | "cube">("sphere");

  const [paths, setPaths] = useState<MotionPath[]>(() => {
    const saved = localStorage.getItem(PATHS_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [customAssets, setCustomAssets] = useState<CustomAsset[]>(() => {
    const saved = localStorage.getItem(ASSETS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse assets from localStorage", e);
      }
    }
    return [];
  });

  const [selectedPathId, setSelectedPathId] = useState<number | null>(null);
  // Paths selected via Ctrl+A (select-all) so they can be deleted alongside
  // shapes via Delete/Backspace. Separate from `selectedPathId`, which
  // tracks the single "active" path for drawing/editing.
  const [selectedPathIds, setSelectedPathIds] = useState<number[]>([]);
  const [activePathWP, setActivePathWP] = useState<number | null>(null);
  const [showPaths, setShowPaths] = useState(true);
  const [drawingAltitude, setDrawingAltitude] = useState(0);
  const [wsSettings, setWsSettings] = useState<WorkspaceSettings>(() =>
    loadWsSettings(),
  );
  const [placementRequest, setPlacementRequest] = useState<DropPayload | null>(null);

  const [liveSimulationFrame, setLiveSimulationFrame] =
    useState<CircuitStreamFrame | null>(null);
  const [circuitLinkOptions, setCircuitLinkOptions] = useState<
    CircuitLinkOption[]
  >([]);
  const [cadStreamConnected, setCadStreamConnected] = useState(false);
  const [lastCircuitStartPayload, setLastCircuitStartPayload] =
    useState<CircuitStreamStartPayload | null>(null);

  useEffect(() => {
    const source = new EventSource(CAD_STREAM_URL);

    source.addEventListener("open", () => {
      setCadStreamConnected(true);
      console.info(
        "[CadModule] Connected to circuit simulation stream",
        CAD_STREAM_URL,
      );
    });

    source.addEventListener("simulation-start", (event) => {
      const payload = JSON.parse(
        (event as MessageEvent).data,
      ) as CircuitStreamStartPayload;
      setCircuitLinkOptions(
        (payload.nodes ?? []).map((node) => ({
          id: node.id,
          label: node.data?.label != null ? String(node.data.label) : node.id,
          componentType:
            node.data?.componentType != null
              ? String(node.data.componentType)
              : "",
        })),
      );
      setLastCircuitStartPayload(payload);
      console.groupCollapsed(
        "[CadModule] simulation-start from Circuit Studio",
      );
      console.log("Payload:", payload);
      console.table(
        payload.nodes?.map((node) => ({
          id: node.id,
          type: node.data?.componentType,
          label: node.data?.label,
          x: node.position?.x,
          y: node.position?.y,
          cadPosition: JSON.stringify(node.data?.cadPosition ?? null),
        })) ?? [],
      );
      console.table(
        payload.edges?.map((edge) => ({
          id: edge.id,
          source: `${edge.source}:${edge.sourceHandle}`,
          target: `${edge.target}:${edge.targetHandle}`,
          color: edge.data?.color,
        })) ?? [],
      );
      console.groupEnd();
    });

    source.addEventListener("simulation-frame", (event) => {
      const frame = JSON.parse(
        (event as MessageEvent).data,
      ) as CircuitStreamFrame;
      setLiveSimulationFrame(frame);
      setCircuitLinkOptions((prev) =>
        mergeCircuitLinkOptionsFromFrame(prev, frame),
      );

      const now =
        typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
      Object.entries(frame.components ?? {}).forEach(
        ([componentId, component]) => {
          if (component.componentType === "servo") {
            const angle = getServoAngle(component);
            if (angle !== null) {
              motionController.current.setManual(componentId, "motor", [angle]);
            }
            return;
          }

          if (component.componentType === "dcmotor") {
            const runtime = motorRuntimeRef.current.get(componentId) ?? {
              angle: 0,
              timestamp: now,
            };
            const elapsedSeconds = Math.max(
              0,
              Math.min(0.2, (now - runtime.timestamp) / 1000),
            );
            runtime.angle +=
              getMotorDegreesPerSecond(component) * elapsedSeconds;
            runtime.timestamp = now;
            motorRuntimeRef.current.set(componentId, runtime);
            motionController.current.setManual(componentId, "motor", [
              runtime.angle,
            ]);
            return;
          }

          // Handle any component with angle telemetry (e.g., encoders, sensors)
          const angle = component.telemetry?.angle;
          if (typeof angle === "number") {
            motionController.current.setManual(componentId, "motor", [angle]);
            return;
          }

          // Handle any component with rpm telemetry (e.g., motor controllers)
          const rpm = component.telemetry?.rpm;
          if (typeof rpm === "number" && rpm !== 0) {
            const runtime = motorRuntimeRef.current.get(componentId) ?? {
              angle: 0,
              timestamp: now,
            };
            const elapsedSeconds = Math.max(
              0,
              Math.min(0.2, (now - runtime.timestamp) / 1000),
            );
            const degreesPerSecond = Math.abs(rpm) * 6;
            const direction =
              String(
                component.telemetry?.direction ?? "forward",
              ).toLowerCase() === "reverse"
                ? -1
                : 1;
            runtime.angle += degreesPerSecond * direction * elapsedSeconds;
            runtime.timestamp = now;
            motorRuntimeRef.current.set(componentId, runtime);
            motionController.current.setManual(componentId, "motor", [
              runtime.angle,
            ]);
          }
        },
      );

      if (frame.serialOutput && frame.serialOutput.length > 0) {
        frame.serialOutput.forEach((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
              const values = JSON.parse(trimmed) as number[];
              values.forEach((val, idx) => {
                const channel = `arduino_${idx + 1}`;
                motionController.current.setManual(channel, "motor", [val]);
              });
            } catch {
              // Ignore invalid formats
            }
          }
        });
      }
    });

    source.addEventListener("simulation-stop", (event) => {
      setLiveSimulationFrame(null);
      setLastCircuitStartPayload(null);
      console.info(
        "[CadModule] simulation-stop",
        JSON.parse((event as MessageEvent).data),
      );
    });

    source.addEventListener("error", () => {
      setCadStreamConnected(false);
      console.warn(
        "[CadModule] Waiting for circuit simulation stream at",
        CAD_STREAM_URL,
      );
    });

    return () => {
      source.close();
      setCadStreamConnected(false);
    };
  }, []);
  // History Stack for Unified Undo/Redo
  const history = useRef<AppState[]>([]);
  const redoStack = useRef<AppState[]>([]);

  const shapesRef = useRef(shapes);
  const pathsRef = useRef(paths);
  const groupsRef = useRef(groups);
  const motorGroupsRef = useRef(motorGroups);
  const meshRefs = useRef(new Map<number, THREE.Object3D>());
  const pendingAutoFlattenRef = useRef(false);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    motorGroupsRef.current = motorGroups;
  }, [motorGroups]);

  // Update Persistence and History
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ shapes, groups, motorGroups }),
      );
    } catch (e) {
      console.warn(
        "Could not save state to localStorage (possibly exceeded quota).",
        e,
      );
      // Optional: alert user if needed
    }
  }, [shapes, groups, motorGroups]);

  useEffect(() => {
    localStorage.setItem(PATHS_KEY, JSON.stringify(paths));
  }, [paths]);

  useEffect(() => {
    try {
      localStorage.setItem(ASSETS_KEY, JSON.stringify(customAssets));
    } catch (e) {
      console.warn("Could not save assets to localStorage", e);
    }
  }, [customAssets]);

  const saveToHistory = (
    newShapes?: ShapeType[],
    newPaths?: MotionPath[],
    newGroups?: GroupType[],
    newMotorGroups?: MotorGroup[],
  ) => {
    history.current.push({
      shapes: JSON.parse(JSON.stringify(shapesRef.current)),
      paths: JSON.parse(JSON.stringify(pathsRef.current)),
      groups: JSON.parse(JSON.stringify(groupsRef.current)),
      motorGroups: JSON.parse(JSON.stringify(motorGroupsRef.current)),
    });
    if (history.current.length > 50) history.current.shift();
    redoStack.current = []; // Clear redo on new action
    if (newShapes) setShapes([...newShapes]);
    if (newPaths) setPaths([...newPaths]);
    if (newGroups) setGroups([...newGroups]);
    if (newMotorGroups) setMotorGroups([...newMotorGroups]);
  };

  const undo = () => {
    if (history.current.length === 0) return;
    const prev = history.current.pop()!;
    redoStack.current.push({
      shapes: JSON.parse(JSON.stringify(shapesRef.current)),
      paths: JSON.parse(JSON.stringify(pathsRef.current)),
      groups: JSON.parse(JSON.stringify(groupsRef.current)),
      motorGroups: JSON.parse(JSON.stringify(motorGroupsRef.current)),
    });
    setShapes(prev.shapes);
    setPaths(prev.paths);
    setGroups(prev.groups);
    setMotorGroups(prev.motorGroups || []);
    setSelectedIds((ids) =>
      ids.filter((id) => prev.shapes.some((s) => s.id === id)),
    );
  };

  const redo = () => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    history.current.push({
      shapes: JSON.parse(JSON.stringify(shapesRef.current)),
      paths: JSON.parse(JSON.stringify(pathsRef.current)),
      groups: JSON.parse(JSON.stringify(groupsRef.current)),
      motorGroups: JSON.parse(JSON.stringify(motorGroupsRef.current)),
    });
    setShapes(next.shapes);
    setPaths(next.paths);
    setGroups(next.groups);
    setMotorGroups(next.motorGroups || []);
    setSelectedIds((ids) =>
      ids.filter((id) => next.shapes.some((s) => s.id === id)),
    );
  };

  const selectedShapes = selectedIds
    .map((id) => shapes.find((s) => s.id === id))
    .filter((s): s is ShapeType => !!s);
  const primarySelected =
    selectedShapes.length > 0
      ? selectedShapes[selectedShapes.length - 1]
      : null;

  // Paths with at least one shape attached are locked from editing (points,
  // loop toggle) so the shape's motion can't be disrupted out from under it.
  const attachedPathIds = new Set(
    shapes
      .map((s) => s.pathId)
      .filter((id): id is number => id !== undefined),
  );

  useEffect(() => {
    if (primarySelected) {
      setEnableCircuitLink(!!primarySelected.circuitNodeId);
      const hasMotion = !!(
        primarySelected.motionChannelId ||
        primarySelected.motionType ||
        primarySelected.jointParentId !== undefined ||
        motorGroups.some((mg) => mg.shapeIds.includes(primarySelected.id))
      );
      setEnableMotionControls(hasMotion);
    } else {
      setEnableCircuitLink(false);
      setEnableMotionControls(false);
    }
  }, [primarySelected?.id]);

  const toLabel = (type: string) =>
    type
      .split(/[\s_-]+/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");

  const getNextShapeName = (type: string) => {
    const base = toLabel(type);
    const count =
      shapes.filter((s) => (s.name || "").startsWith(base)).length + 1;
    return `${base} ${count}`;
  };

  const getNextGroupName = (base: string) => {
    const count =
      groups.filter((g) => (g.name || "").startsWith(base)).length + 1;
    return `${base} ${count}`;
  };

  useEffect(() => {
    const hasUnnamedShapes = shapes.some(
      (s) => !s.name || s.name.trim().length === 0,
    );
    if (!hasUnnamedShapes) return;
    const counters = new Map<string, number>();
    const nextShapes = shapes.map((s) => {
      if (s.name && s.name.trim().length > 0) return s;
      const base = toLabel(s.type);
      const count = (counters.get(base) || 0) + 1;
      counters.set(base, count);
      return { ...s, name: `${base} ${count}` };
    });
    setShapes(nextShapes);
  }, [shapes]);

  useEffect(() => {
    const hasUnnamedGroups = groups.some(
      (g) => !g.name || g.name.trim().length === 0,
    );
    if (!hasUnnamedGroups) return;
    let idx = 0;
    const nextGroups = groups.map((g) => {
      if (g.name && g.name.trim().length > 0) return g;
      idx += 1;
      return { ...g, name: `Group ${idx}` };
    });
    setGroups(nextGroups);
  }, [groups]);

  const setPrimaryCircuitNodeId = (circuitNodeId: string) => {
    if (!primarySelected || primarySelected.isLocked) return;
    const trimmed = circuitNodeId.trim();
    const componentType = getCircuitComponentType(
      trimmed,
      liveSimulationFrame,
      circuitLinkOptions,
      lastCircuitStartPayload,
    );

    // Check if component has motion-relevant telemetry
    const component = liveSimulationFrame?.components?.[trimmed];
    const hasAngleTelemetry = typeof component?.telemetry?.angle === "number";
    const hasRpmTelemetry = typeof component?.telemetry?.rpm === "number";
    const drivesRotation =
      componentType === "servo" ||
      componentType === "dcmotor" ||
      hasAngleTelemetry ||
      hasRpmTelemetry;

    // Update shape circuit node and motion channel
    const nextShapes = shapes.map((s) =>
      s.id === primarySelected.id
        ? {
            ...s,
            circuitNodeId: trimmed ? trimmed : undefined,
            ...(drivesRotation
              ? {
                  motionChannelId: trimmed,
                  motionType: "motor" as const,
                  jointAxis: "y" as const,
                }
              : !trimmed || s.motionChannelId === s.circuitNodeId
                ? {
                    motionChannelId: undefined,
                    motionType: undefined,
                  }
                : {}),
          }
        : s,
    );

    // Update motor groups that contain this shape to use the circuit node as motion channel
    const nextMotorGroups = motorGroups.map((mg) => {
      if (
        mg.shapeIds.includes(primarySelected.id) &&
        drivesRotation &&
        trimmed
      ) {
        return {
          ...mg,
          motionChannelId: trimmed,
        };
      }
      return mg;
    });

    saveToHistory(nextShapes, undefined, undefined, nextMotorGroups);
  };

  const duplicateShape = () => {
    if (selectedIds.length === 0) return;
    const newShapes: ShapeType[] = [];
    const newIds: number[] = [];
    selectedShapes.forEach((s) => {
      const nid = generateRuntimeId();
      newIds.push(nid);
      newShapes.push({
        ...s,
        id: nid,
        isLocked: false,
        position: [s.position[0] + 1, s.position[1], s.position[2] + 1],
      });
    });
    saveToHistory([...shapes, ...newShapes]);
    setSelectedIds(newIds);
  };

  // Read a shape's actual rendered world position from meshRefs.
  // When meshRefs returns the GROUP element (isCSGGroup=true), compute
  // from the group's world Y shift + shape state position.
  const getSyncedPosition = (s: ShapeType): [number, number, number] => {
    const obj = meshRefs.current.get(s.id);
    if (!obj) return [...s.position];
    obj.updateMatrixWorld(true);
    if (obj.userData.isCSGGroup) {
      const gp = new THREE.Vector3();
      obj.getWorldPosition(gp);
      return [s.position[0] + gp.x, s.position[1] + gp.y, s.position[2] + gp.z];
    }
    const wp = new THREE.Vector3();
    obj.getWorldPosition(wp);
    return [wp.x, wp.y, wp.z];
  };

  const groupShapes = () => {
    if (selectedIds.length < 2) return;
    const members = selectedIds
      .map((id) => shapes.find((s) => s.id === id))
      .filter((s): s is ShapeType => !!s);
    if (members.some((s) => s.isLocked)) return;

    // Collect existing parentIds from the selected shapes
    const existingParentIds = new Set(
      members
        .map((s) => s.parentId)
        .filter((pid): pid is number => pid !== undefined),
    );

    // If shapes belong to more than one different group, refuse to nest-group them
    // (they'd need to be ungrouped first). Allow if they all share the same group
    // or if none are grouped yet.
    if (existingParentIds.size > 1) {
      console.warn(
        "groupShapes: Cannot group shapes that belong to different groups. Ungroup them first.",
      );
      return;
    }

    // If all selected shapes already share a single group, do nothing
    if (
      existingParentIds.size === 1 &&
      members.every((s) => s.parentId === Array.from(existingParentIds)[0])
    ) {
      return;
    }

    const groupId = generateRuntimeId();
    const syncedPositions = members.map((s) => getSyncedPosition(s));
    const pivot: [number, number, number] = [
      syncedPositions.reduce((a, p) => a + p[0], 0) / members.length,
      syncedPositions.reduce((a, p) => a + p[1], 0) / members.length,
      syncedPositions.reduce((a, p) => a + p[2], 0) / members.length,
    ];

    const nextShapes = shapes.map((s) => {
      const idx = selectedIds.indexOf(s.id);
      if (idx === -1) return s;
      return {
        ...s,
        parentId: groupId,
        groupType: "standard" as const,
        position: syncedPositions[idx],
      };
    });
    const nextGroups = [
      ...groups,
      {
        id: groupId,
        name: getNextGroupName("Group"),
        isJoint: false,
        jointAxis: "y" as const,
        jointRotation: 0,
        pivot,
      },
    ];
    saveToHistory(nextShapes, undefined, nextGroups);
    pendingAutoFlattenRef.current = true;
  };

  const makeSelectedGroupJoint = (
    axis: "x" | "y" | "z",
    parentGroupId?: number,
  ) => {
    if (selectedIds.length === 0) return;
    const selected = selectedIds
      .map((id) => shapes.find((s) => s.id === id))
      .filter((s): s is ShapeType => !!s);
    if (selected.length === 0) return;
    const groupId = selected[0].parentId;
    if (!groupId) return;
    let safeParentGroupId = parentGroupId;
    const wouldCreateCycle = (candidateParentId: number) => {
      if (candidateParentId === groupId) return true;
      let current: number | undefined = candidateParentId;
      const seen = new Set<number>();
      while (current != null) {
        if (current === groupId) return true;
        if (seen.has(current)) return true;
        seen.add(current);
        current = groups.find((g) => g.id === current)?.parentGroupId;
      }
      return false;
    };
    if (safeParentGroupId != null && wouldCreateCycle(safeParentGroupId)) {
      safeParentGroupId = undefined;
    }

    const nextGroups = groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            name:
              g.name && g.name.trim().length > 0
                ? g.name
                : getNextGroupName("Joint"),
            isJoint: true,
            jointAxis: axis,
            jointRotation: 0,
            parentGroupId: safeParentGroupId,
          }
        : g,
    );
    const ensured = nextGroups.some((g) => g.id === groupId)
      ? nextGroups
      : [
          ...nextGroups,
          {
            id: groupId,
            name: getNextGroupName("Joint"),
            isJoint: true,
            jointAxis: axis,
            jointRotation: 0,
            parentGroupId: safeParentGroupId,
          },
        ];
    saveToHistory(undefined, undefined, ensured);
  };

  const updateSelectedGroupJointRotation = (rotation: number) => {
    if (selectedIds.length === 0) return;
    const selected = shapes.filter((s) => selectedIds.includes(s.id));
    if (selected.length === 0) return;
    const groupId = selected[0].parentId;
    if (!groupId) return;
    const nextGroups = groups.map((g) =>
      g.id === groupId ? { ...g, jointRotation: rotation } : g,
    );
    saveToHistory(undefined, undefined, nextGroups);
  };

  const updateGroupJointRotationById = (groupId: number, rotation: number) => {
    const nextGroups = groups.map((g) =>
      g.id === groupId ? { ...g, jointRotation: rotation } : g,
    );
    saveToHistory(undefined, undefined, nextGroups);
  };

  const updateGroupMotion = (
    groupId: number,
    channelId?: string,
    type?: "motor" | "xyz_rotation" | "linear",
    inverted?: boolean,
  ) => {
    const nextGroups = groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            motionChannelId:
              channelId !== undefined ? channelId : g.motionChannelId,
            motionType: type !== undefined ? type : g.motionType,
            motionInverted:
              inverted !== undefined ? inverted : g.motionInverted,
          }
        : g,
    );
    saveToHistory(undefined, undefined, nextGroups);
  };

  const updateSelectedGroupPivot = (pivot: [number, number, number]) => {
    if (selectedIds.length === 0) return;
    const selected = shapes.filter((s) => selectedIds.includes(s.id));
    if (selected.length === 0) return;
    const groupId = selected[0].parentId;
    if (!groupId) return;
    const nextGroups = groups.map((g) =>
      g.id === groupId ? { ...g, pivot } : g,
    );
    saveToHistory(undefined, undefined, nextGroups);
  };

  const updateSelectedGroupPivotShapeId = (pivotShapeId?: number) => {
    if (selectedIds.length === 0) return;
    const selected = shapes.filter((s) => selectedIds.includes(s.id));
    if (selected.length === 0) return;
    const groupId = selected[0].parentId;
    if (!groupId) return;
    const nextGroups = groups.map((g) =>
      g.id === groupId ? { ...g, pivotShapeId } : g,
    );
    saveToHistory(undefined, undefined, nextGroups);
  };

  const applyJointCommands = (commands: JointCommand[]) => {
    if (!Array.isArray(commands) || commands.length === 0) return;
    const cmdMap = new Map<number, number>();
    commands.forEach((cmd) => {
      if (
        typeof cmd?.jointId === "number" &&
        typeof cmd?.angleDeg === "number" &&
        Number.isFinite(cmd.angleDeg)
      ) {
        cmdMap.set(cmd.jointId, cmd.angleDeg);
      }
    });
    if (cmdMap.size === 0) return;
    const nextGroups = groups.map((g) =>
      cmdMap.has(g.id) ? { ...g, jointRotation: cmdMap.get(g.id)! } : g,
    );
    saveToHistory(undefined, undefined, nextGroups);
  };

  // MotorGroup management functions
  const createMotorGroup = (
    shapeIds: number[],
    name?: string,
    motionChannelId?: string,
    motionType?: MotionType,
    motionInverted?: boolean,
    jointAxis?: "x" | "y" | "z",
  ) => {
    console.log("createMotorGroup called with shapeIds:", shapeIds);
    console.log("shapeIds length:", shapeIds.length);
    const newId = generateRuntimeId();
    const newMotorGroup: MotorGroup = {
      id: newId,
      name: name || `Motor ${motorGroups.length + 1}`,
      shapeIds: [...shapeIds],
      motionChannelId,
      motionType,
      motionInverted,
      jointAxis,
    };
    console.log("Created motor group with shapeIds:", newMotorGroup.shapeIds);
    saveToHistory(undefined, undefined, undefined, [
      ...motorGroups,
      newMotorGroup,
    ]);
    return newId;
  };

  const updateMotorGroupShapes = (motorGroupId: number, shapeIds: number[]) => {
    const nextMotorGroups = motorGroups.map((mg) =>
      mg.id === motorGroupId ? { ...mg, shapeIds: [...shapeIds] } : mg,
    );
    saveToHistory(undefined, undefined, undefined, nextMotorGroups);
  };

  const updateMotorGroupMotion = (
    motorGroupId: number,
    channelId?: string,
    type?: MotionType,
    inverted?: boolean,
    vehicleRole?: "drive" | "steer" | "none",
  ) => {
    const nextMotorGroups = motorGroups.map((mg) =>
      mg.id === motorGroupId
        ? {
            ...mg,
            ...(channelId !== undefined && { motionChannelId: channelId }),
            ...(type !== undefined && { motionType: type }),
            ...(inverted !== undefined && { motionInverted: inverted }),
            ...(vehicleRole !== undefined && { vehicleRole: vehicleRole }),
          }
        : mg,
    );
    saveToHistory(undefined, undefined, undefined, nextMotorGroups);
  };

  const deleteMotorGroup = (motorGroupId: number) => {
    const nextMotorGroups = motorGroups.filter((mg) => mg.id !== motorGroupId);
    saveToHistory(undefined, undefined, undefined, nextMotorGroups);
  };

  const updateMotorGroupPivot = (
    motorGroupId: number,
    pivot: [number, number, number],
  ) => {
    const nextMotorGroups = motorGroups.map((mg) =>
      mg.id === motorGroupId ? { ...mg, pivot } : mg,
    );
    saveToHistory(undefined, undefined, undefined, nextMotorGroups);
  };

  const updateMotorGroupAxis = (
    motorGroupId: number,
    jointAxis: "x" | "y" | "z",
    pivotShapeId?: number,
  ) => {
    const nextMotorGroups = motorGroups.map((mg) =>
      mg.id === motorGroupId
        ? {
            ...mg,
            jointAxis,
            ...(pivotShapeId !== undefined && { pivotShapeId }),
          }
        : mg,
    );
    saveToHistory(undefined, undefined, undefined, nextMotorGroups);
  };

  const updateMotorGroupLimits = (
    motorGroupId: number,
    minLimit?: number,
    maxLimit?: number,
  ) => {
    const nextMotorGroups = motorGroups.map((mg) =>
      mg.id === motorGroupId ? { ...mg, minLimit, maxLimit } : mg,
    );
    saveToHistory(undefined, undefined, undefined, nextMotorGroups);
  };

  useEffect(() => {
    // Debug helper for external instruction arrays in dev console/integration tests.
    (window as any).applyJointCommands = (commands: JointCommand[]) => {
      applyJointCommands(commands);
    };
    return () => {
      if ((window as any).applyJointCommands) {
        delete (window as any).applyJointCommands;
      }
    };
  }, [groups]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && placementRequest) {
        setPlacementRequest(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [placementRequest]);


  const subtractShapes = () => {
    if (selectedIds.length < 2) return;
    const primaryId = selectedIds[0];
    const groupId = generateRuntimeId();
    const members = selectedIds
      .map((id) => shapes.find((s) => s.id === id))
      .filter((s): s is ShapeType => !!s);
    if (members.some((s) => s.isLocked)) return;
    const syncedPositions = members.map((s) => getSyncedPosition(s));
    const pivot: [number, number, number] = [
      syncedPositions.reduce((a, p) => a + p[0], 0) / members.length,
      syncedPositions.reduce((a, p) => a + p[1], 0) / members.length,
      syncedPositions.reduce((a, p) => a + p[2], 0) / members.length,
    ];

    const nextShapes = shapes.map((s) => {
      const idx = selectedIds.indexOf(s.id);
      if (idx === -1) return s;
      const nextIsHole = s.id !== primaryId;
      return {
        ...s,
        parentId: groupId as any,
        isHole: nextIsHole,
        preHoleColor: nextIsHole ? s.color : undefined,
        color: nextIsHole ? "#ffffff" : s.color,
        groupType: "boolean" as const,
        position: syncedPositions[idx],
      };
    });
    const nextGroups = [
      ...groups,
      {
        id: groupId as any,
        name: getNextGroupName("Boolean Group"),
        isJoint: false,
        jointAxis: "y" as const,
        jointRotation: 0,
        pivot,
      },
    ];
    saveToHistory(nextShapes, undefined, nextGroups);
    pendingAutoFlattenRef.current = true;
  };

  const ungroupShapes = () => {
    if (selectedIds.length === 0) return;

    // Find all parentIds of the selected shapes
    const parentIdsToUngroup = new Set<number>();
    shapes.forEach((s) => {
      if (selectedIds.includes(s.id) && s.parentId) {
        parentIdsToUngroup.add(s.parentId);
      }
    });

    if (parentIdsToUngroup.size === 0) {
      // No grouped shapes selected — nothing to ungroup
      return;
    }

    if (
      shapes.some((s) => s.parentId && parentIdsToUngroup.has(s.parentId) && s.isLocked)
    ) {
      return;
    }

    // Ungroup all shapes whose parentId is being removed
    const nextShapes = shapes.map((s) =>
      s.parentId && parentIdsToUngroup.has(s.parentId)
        ? { ...s, parentId: undefined, groupType: undefined }
        : s,
    );

    // Remove the group entries being ungrouped, AND also clean up any child
    // groups (joint chains) whose parentGroupId was one of the removed groups
    // to avoid orphaned group definitions.
    const removedGroupIds = new Set(parentIdsToUngroup);
    const nextGroups = groups.filter((g) => {
      if (removedGroupIds.has(g.id)) return false;
      // Also remove child groups whose parent has been removed
      if (
        g.parentGroupId !== undefined &&
        removedGroupIds.has(g.parentGroupId)
      ) {
        removedGroupIds.add(g.id); // cascade: mark this child as removed too
        return false;
      }
      return true;
    });

    saveToHistory(nextShapes, undefined, nextGroups);
  };

  // Drop groups/motorGroups that no longer have any surviving member shape,
  // so deleting shapes doesn't leave stale group definitions behind (which
  // otherwise inflate getNextGroupName's counters and linger in the UI).
  const pruneOrphanedGroups = (remainingShapes: ShapeType[]) => {
    const referencedGroupIds = new Set(
      remainingShapes
        .map((s) => s.parentId)
        .filter((id): id is number => id !== undefined),
    );
    const nextGroups = groups.filter((g) => referencedGroupIds.has(g.id));
    // Keep ancestor groups (joint chains) of any group we're keeping.
    let changed = true;
    while (changed) {
      changed = false;
      const keptIds = new Set(nextGroups.map((g) => g.id));
      for (const g of groups) {
        if (keptIds.has(g.id)) continue;
        if (
          nextGroups.some(
            (kept) => kept.parentGroupId === g.id,
          )
        ) {
          nextGroups.push(g);
          changed = true;
        }
      }
    }
    const remainingIds = new Set(remainingShapes.map((s) => s.id));
    const nextMotorGroups = motorGroups.filter((mg) =>
      mg.shapeIds.some((id) => remainingIds.has(id)),
    );
    return { nextGroups, nextMotorGroups };
  };

  const deleteSelectedShapes = () => {
    if (selectedIds.length === 0 && selectedPathIds.length === 0) return;
    const remaining = shapes
      .filter((s) => !selectedIds.includes(s.id) || s.isLocked)
      .map((s) =>
        s.pathId !== undefined && selectedPathIds.includes(s.pathId)
          ? { ...s, pathId: undefined, pathSpeed: undefined }
          : s,
      );
    const nextPaths = paths.filter((p) => !selectedPathIds.includes(p.id));
    const { nextGroups, nextMotorGroups } = pruneOrphanedGroups(remaining);
    saveToHistory(remaining, nextPaths, nextGroups, nextMotorGroups);
    setSelectedIds([]);
    setSelectedPathIds([]);
  };

  const confirmClearCanvas = () => {
    saveToHistory([], [], [], []);
    setSelectedIds([]);
    setSelectedPathId(null);
    setActivePathWP(null);
    setShowClearConfirm(false);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const clearCanvas = () => {
    if (shapes.length === 0 && paths.length === 0) return;
    setShowClearConfirm(true);
  };

  // Flatten a CSG group into a standalone "custom" shape (bake)
  const flattenGroup = () => {
    const groupShapeIds = selectedShapes.map((s) => s.id);
    if (groupShapeIds.length < 2) return;
    // All selected shapes must share same parentId (or we pick the first's parentId)
    const pid = selectedShapes[0].parentId;
    if (!pid) return; // not a group

    const members = selectedShapes.filter((s) => s.parentId === pid);
    if (members.length < 2) return;
    if (members.some((m) => m.isLocked)) return;

    // Get the actual rendered world position for a member.
    // When meshRefs returns the GROUP element (isCSGGroup = true), the group acts
    // as a single atomic object shifted by keepObjectAboveCanvas. In that case the
    // member's actual position is its state position + the group's Y shift.
    const getActualMemberPos = (m: ShapeType): [number, number, number] => {
      const obj = meshRefs.current.get(m.id);
      if (!obj) return [...m.position];
      obj.updateMatrixWorld(true);
      if (obj.userData.isCSGGroup) {
        const groupWorldPos = new THREE.Vector3();
        obj.getWorldPosition(groupWorldPos);
        return [
          m.position[0] + groupWorldPos.x,
          m.position[1] + groupWorldPos.y,
          m.position[2] + groupWorldPos.z,
        ];
      }
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      return [worldPos.x, worldPos.y, worldPos.z];
    };

    const solids = members.filter((m) => !m.isHole);
    const solidWorldPos = solids.map((s) => getActualMemberPos(s));
    const anchor: [number, number, number] = [
      solidWorldPos.reduce((acc, p) => acc + p[0], 0) / solidWorldPos.length,
      solidWorldPos.reduce((acc, p) => acc + p[1], 0) / solidWorldPos.length,
      solidWorldPos.reduce((acc, p) => acc + p[2], 0) / solidWorldPos.length,
    ];

    const customMembers: CustomMember[] = [];
    members.forEach((m) => {
      const worldPos = getActualMemberPos(m);
      if (m.type === "custom" && m.customMembers) {
        customMembers.push({
          type: "custom",
          url: m.url,
          offset: [
            worldPos[0] - anchor[0],
            worldPos[1] - anchor[1],
            worldPos[2] - anchor[2],
          ],
          rotation: [...m.rotation] as [number, number, number],
          scale: [...m.scale] as [number, number, number],
          isHole: !!m.isHole,
          color: m.color,
          customMembers: m.customMembers,
        });
      } else {
        customMembers.push({
          type: m.type as any,
          url: m.url,
          offset: [
            worldPos[0] - anchor[0],
            worldPos[1] - anchor[1],
            worldPos[2] - anchor[2],
          ],
          rotation: [...m.rotation] as [number, number, number],
          scale: [...m.scale] as [number, number, number],
          isHole: !!m.isHole,
          color: m.color,
        });
      }
    });

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    members.forEach((m) => {
      if (m.isHole) return;
      const bSize = m.baseSize || [1, 1, 1];
      const sx = bSize[0] * m.scale[0];
      const sy = bSize[1] * m.scale[1];
      const sz = bSize[2] * m.scale[2];

      const worldPos = getActualMemberPos(m);
      const x = worldPos[0];
      const y = worldPos[1];
      const z = worldPos[2];

      minX = Math.min(minX, x - sx / 2);
      minY = Math.min(minY, y - sy / 2);
      minZ = Math.min(minZ, z - sz / 2);

      maxX = Math.max(maxX, x + sx / 2);
      maxY = Math.max(maxY, y + sy / 2);
      maxZ = Math.max(maxZ, z + sz / 2);
    });

    const calculatedBaseSize: [number, number, number] = [
      minX === Infinity ? 1 : Math.max(0.1, maxX - minX),
      minY === Infinity ? 1 : Math.max(0.1, maxY - minY),
      minZ === Infinity ? 1 : Math.max(0.1, maxZ - minZ),
    ];

    const uniqueColors = new Set(solids.map((s) => s.color).filter(Boolean));
    const commonColor =
      uniqueColors.size === 1 ? Array.from(uniqueColors)[0] : "#ffffff";

    const newId = generateRuntimeId();
    const newShape: ShapeType = {
      id: newId,
      type: "custom",
      position: anchor,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: commonColor,
      isLocked: false,
      isHole: false,
      customMembers,
      baseSize: calculatedBaseSize,
    };

    // Remove group members and add the baked custom shape
    const remaining = shapes.filter((s) => members.every((m) => m.id !== s.id));
    saveToHistory([...remaining, newShape]);
    setSelectedIds([newId]);
  };

  // After Add/Subtract creates a group, automatically bake it into a single
  // saved object (equivalent to "Save as New Object") instead of requiring
  // a manual extra step. Deferred a frame so mesh world matrices are current.
  useEffect(() => {
    if (!pendingAutoFlattenRef.current) return;
    pendingAutoFlattenRef.current = false;
    const raf = requestAnimationFrame(() => flattenGroup());
    return () => cancelAnimationFrame(raf);
  }, [shapes, groups]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const step = snapToGrid ? snapIncrement : 0.1;

      if (isCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (isCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (isCtrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateShape();
        return;
      }
      if (isCtrl && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(shapes.map((s) => s.id));
        setSelectedPathIds(paths.map((p) => p.id));
        return;
      }
      if (isCtrl && e.key.toLowerCase() === "g") {
        e.preventDefault();
        const hasGrouped = selectedIds.some((id) => {
          const s = shapes.find((x) => x.id === id);
          return s && s.parentId;
        });
        if (hasGrouped) {
          ungroupShapes();
        } else {
          groupShapes();
        }
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          nudge(-step, 0, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          nudge(step, 0, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (e.altKey) nudge(0, step, 0);
          else nudge(0, 0, -step);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (e.altKey) nudge(0, -step, 0);
          else nudge(0, 0, step);
          break;
      }

      switch (e.key.toLowerCase()) {
        case "w":
        case "t":
          setMode("translate");
          break;
        case "e":
          setMode("erase");
          break;
        case "r":
          setMode("rotate");
          break;
        case "s": // Changed from 'r' to 's' to avoid conflict with rotate
          setMode("scale");
          break;
        case "delete":
        case "backspace":
          deleteSelectedShapes();
          break;
        case "escape":
          setSelectedIds([]);
          setSelectedPathIds([]);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // `wsSettings` added: the captured `nudge` closure reads
    // wsSettings.presetWidth/presetLength to clamp movement to the workspace,
    // but the array never listed it — so after resizing the workspace, arrow-key
    // nudge went on clamping to the OLD bounds until some unrelated dependency
    // happened to change. See BUG-048.
  }, [selectedIds, shapes, snapToGrid, snapIncrement, paths, selectedPathIds, wsSettings]);

  // Helper: nudge selected shapes by (dx, dy, dz), clamped to workspace bounds
  const nudge = (dx: number, dy: number, dz: number) => {
    if (selectedIds.length === 0) return;
    const width = wsSettings?.presetWidth || 223;
    const length = wsSettings?.presetLength || 223;
    const halfX = width / 2;
    const halfZ = length / 2;
    const maxY = Math.max(width, length) / 2;
    const minX = -halfX + 0.5;
    const maxX = halfX - 0.5;
    const minY = 0.01;
    const maxYVal = maxY - 0.5;
    const minZ = -halfZ + 0.5;
    const maxZ = halfZ - 0.5;

    saveToHistory(
      shapes.map((s) => {
        if (!selectedIds.includes(s.id) || s.isLocked) return s;
        const nx = Math.max(minX, Math.min(maxX, s.position[0] + dx));
        const ny = Math.max(minY, Math.min(maxYVal, s.position[1] + dy));
        const nz = Math.max(minZ, Math.min(maxZ, s.position[2] + dz));
        return { ...s, position: [nx, ny, nz] as [number, number, number] };
      }),
    );
  };

  const updateRotation = (axis: number, value: number) => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? {
              ...s,
              rotation: s.rotation.map((r, i) => (i === axis ? value : r)) as [
                number,
                number,
                number,
              ],
            }
          : s,
      ),
    );
  };

  const updateColor = (color: string) => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked && !s.isHole
          ? { ...s, color }
          : s,
      ),
    );
  };

  // DEV-only test hook, same convention as SimulationScene.tsx's
  // window.__vehicleProbe — stripped
  // from production builds via (process.env.NODE_ENV !== "production"). Lets a script trigger
  // real, repeated recolors through the actual shapes state, to exercise
  // CustomShapeMesh.tsx's CSG recompute path: a standalone custom shape's
  // own boolean-fold geometry is position/rotation/scale-invariant (only
  // customMembers/color feed evaluateCustomGeometry), so the arrow-key
  // position nudge that drives CSGGroup.tsx's e2e coverage doesn't touch
  // this component's depsKey at all — there is no existing keyboard-driven
  // path to rapidly recolor a shape, only the mouse-driven color picker.
  useEffect(() => {
    if (!(process.env.NODE_ENV !== "production")) return;
    window.__csgTestRecolor = (id: number, color: string) => {
      setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, color } : s)));
    };
    return () => {
      delete window.__csgTestRecolor;
    };
  }, []);

  const updateShapePhysicsProperty = (
    id: number,
    key:
      | "friction"
      | "restitution"
      | "fixedRotation"
      | "mass"
      | "collisionDisabled"
      | "name",
    value: any,
  ) => {
    saveToHistory(
      shapes.map((s) =>
        s.id === id && !s.isLocked ? { ...s, [key]: value } : s,
      ),
    );
  };

  const updateTexture = (texturePath: string | null) => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked && !s.isHole
          ? { ...s, texturePath: texturePath ?? undefined }
          : s,
      ),
    );
  };

  const toggleHole = () => {
    saveToHistory(
      shapes.map((s) => {
        if (selectedIds.includes(s.id) && !s.isLocked) {
          const nextIsHole = !s.isHole;
          return {
            ...s,
            isHole: nextIsHole,
            preHoleColor: nextIsHole ? s.color : undefined,
            color: nextIsHole
              ? "#ffffff"
              : s.preHoleColor || s.color || "#ffffff",
          };
        }
        return s;
      }),
    );
  };

  const attachToPath = (pathId: number) => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked && s.pathId === undefined
          ? { ...s, pathId, pathSpeed: 1 }
          : s,
      ),
    );
  };

  const detachFromPath = () => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? { ...s, pathId: undefined, pathSpeed: undefined }
          : s,
      ),
    );
  };

  const deletePath = (pathId: number) => {
    const nextPaths = paths.filter((p) => p.id !== pathId);
    const nextShapes = shapes.map((s) =>
      s.pathId === pathId
        ? { ...s, pathId: undefined, pathSpeed: undefined }
        : s,
    );
    saveToHistory(nextShapes, nextPaths);
  };

  const updatePathSpeed = (speed: number) => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked && s.pathId !== undefined
          ? { ...s, pathSpeed: speed }
          : s,
      ),
    );
  };

  const toggleLock = () => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) ? { ...s, isLocked: !s.isLocked } : s,
      ),
    );
  };

  const toggleGripper = () => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? {
              ...s,
              isGripper: !s.isGripper,
              isGripping: !s.isGripper ? false : s.isGripping,
            }
          : s,
      ),
    );
  };

  const toggleGripping = () => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? { ...s, isGripping: !s.isGripping }
          : s,
      ),
    );
  };

  const toggleGrabbable = () => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? { ...s, grabbable: !s.grabbable }
          : s,
      ),
    );
  };

  const updateGripOffset = (axis: number, value: number) => {
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? {
              ...s,
              gripOffset: (s.gripOffset || [0, 0, 0]).map((v, i) =>
                i === axis ? value : v,
              ) as [number, number, number],
            }
          : s,
      ),
    );
  };

  const addShape = (
    type: string,
    pos?: [number, number, number],
    rot?: [number, number, number],
  ) => {
    const defaultColors: Record<string, string> = {
      cube: "#ee4444",
      sphere: "#06b6d4",
      cylinder: "#22c55e",
      cone: "#eab308",
      torus: "#a855f7",
      hexagon: "#3b82f6",
      cogwheel: "#f97316",
      "cogwheel-6t": "#f97316",
      "cogwheel-8t": "#fb923c",
      "cogwheel-12t": "#fdba74",
      "cogwheel-16t": "#fed7aa",
      pipe: "#94a3b8",
      lbracket: "#f97316",
      arch: "#8b5cf6",
      stairs: "#ec4899",
      bowl: "#14b8a6",
    };
    const nid = generateRuntimeId();
    const shapeName = getNextShapeName(type);
    const defaultSpawnScale: [number, number, number] = [10, 10, 10];
    const spawnIndex = shapes.length;
    const defaultSpawnPosition: [number, number, number] = pos || [
      (spawnIndex % 5) * 12,
      5,
      Math.floor(spawnIndex / 5) * 12,
    ];
    const defaultSpawnRotation: [number, number, number] = rot || [0, 0, 0];

    if (type === "pipe") {
      saveToHistory([
        ...shapes,
        {
          id: nid,
          name: shapeName,
          type: "custom",
          scale: defaultSpawnScale,
          rotation: defaultSpawnRotation,
          position: defaultSpawnPosition,
          color: defaultColors.pipe,
          isLocked: false,
          isHole: false,
          customMembers: [
            {
              type: "cylinder",
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              isHole: false,
            },
            {
              type: "cylinder",
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [0.75, 1.1, 0.75],
              isHole: true,
            },
          ],
        },
      ]);
    } else if (type === "lbracket") {
      saveToHistory([
        ...shapes,
        {
          id: nid,
          name: shapeName,
          type: "custom",
          scale: defaultSpawnScale,
          rotation: [0, 0, 0],
          position: defaultSpawnPosition,
          color: defaultColors.lbracket,
          isLocked: false,
          isHole: false,
          customMembers: [
            {
              type: "cube",
              offset: [-0.35, 0, 0],
              rotation: [0, 0, 0],
              scale: [0.3, 1, 1],
              isHole: false,
            },
            {
              type: "cube",
              offset: [0, -0.35, 0],
              rotation: [0, 0, 0],
              scale: [1, 0.3, 1],
              isHole: false,
            },
          ],
        },
      ]);
    } else if (type === "arch") {
      saveToHistory([
        ...shapes,
        {
          id: nid,
          name: shapeName,
          type: "custom",
          scale: defaultSpawnScale,
          rotation: [0, 0, 0],
          position: defaultSpawnPosition,
          color: defaultColors.arch,
          isLocked: false,
          isHole: false,
          customMembers: [
            {
              type: "cube",
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1.2, 0.4],
              isHole: false,
            },
            {
              type: "cylinder",
              offset: [0, -0.2, 0],
              rotation: [Math.PI / 2, 0, 0],
              scale: [0.6, 1, 0.6],
              isHole: true,
            },
            {
              type: "cube",
              offset: [0, -0.5, 0],
              rotation: [0, 0, 0],
              scale: [0.6, 0.6, 1],
              isHole: true,
            },
          ],
        },
      ]);
    } else if (type === "stairs") {
      saveToHistory([
        ...shapes,
        {
          id: nid,
          name: shapeName,
          type: "custom",
          scale: defaultSpawnScale,
          rotation: [0, 0, 0],
          position: defaultSpawnPosition,
          color: defaultColors.stairs,
          isLocked: false,
          isHole: false,
          customMembers: [
            {
              type: "cube",
              offset: [0, -0.335, 0.33],
              rotation: [0, 0, 0],
              scale: [1, 0.33, 0.33],
              isHole: false,
            },
            {
              type: "cube",
              offset: [0, -0.17, 0],
              rotation: [0, 0, 0],
              scale: [1, 0.66, 0.33],
              isHole: false,
            },
            {
              type: "cube",
              offset: [0, 0, -0.33],
              rotation: [0, 0, 0],
              scale: [1, 1, 0.33],
              isHole: false,
            },
          ],
        },
      ]);
    } else if (type === "bowl") {
      saveToHistory([
        ...shapes,
        {
          id: nid,
          name: shapeName,
          type: "custom",
          scale: defaultSpawnScale,
          rotation: [0, 0, 0],
          position: defaultSpawnPosition,
          color: defaultColors.bowl,
          isLocked: false,
          isHole: false,
          customMembers: [
            {
              type: "sphere",
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              isHole: false,
            },
            {
              type: "sphere",
              offset: [0, 0.1, 0],
              rotation: [0, 0, 0],
              scale: [0.85, 0.85, 0.85],
              isHole: true,
            },
            {
              type: "cube",
              offset: [0, 0.5, 0],
              rotation: [0, 0, 0],
              scale: [1.2, 1, 1.2],
              isHole: true,
            },
          ],
        },
      ]);
    } else {
      saveToHistory([
        ...shapes,
        {
          id: nid,
          name: shapeName,
          type: type as any,
          scale: defaultSpawnScale,
          rotation: defaultSpawnRotation,
          position: defaultSpawnPosition,
          color: defaultColors[type] || "#ffffff",
          isLocked: false,
          isHole: false,
        },
      ]);
    }
    setSelectedIds([nid]);
  };

  const addGlbShape = (
    url: string,
    pos?: [number, number, number],
    rot?: [number, number, number],
  ) => {
    const nid = generateRuntimeId();
    const defaultSpawnScale: [number, number, number] = [10, 10, 10];
    const spawnIndex = shapes.length;
    const defaultSpawnPosition: [number, number, number] = pos || [
      (spawnIndex % 5) * 12,
      5,
      Math.floor(spawnIndex / 5) * 12,
    ];
    saveToHistory([
      ...shapes,
      {
        id: nid,
        name: getNextShapeName("GLB"),
        type: "glb",
        scale: defaultSpawnScale,
        rotation: rot || [0, 0, 0],
        position: defaultSpawnPosition,
        color: "#ffffff",
        isLocked: false,
        isHole: false,
        url,
      },
    ]);
    setSelectedIds([nid]);
  };

  const addCustomAsset = (name: string, url: string) => {
    setCustomAssets((prev) => {
      if (prev.some((asset) => asset.name === name)) {
        return prev;
      }
      return [
        ...prev,
        { id: Date.now().toString() + Math.random().toString(), name, url },
      ];
    });
  };

  const removeCustomAsset = (id: string) => {
    setCustomAssets((prev) => prev.filter((asset) => asset.id !== id));
  };

  const updateScale = (axis: number, value: number) => {
    const clampedValue = Math.max(0.1, value);
    saveToHistory(
      shapes.map((s) => {
        if (!selectedIds.includes(s.id) || s.isLocked) return s;

        const newScale = s.scale.map((sc, i) =>
          i === axis ? clampedValue : sc,
        ) as [number, number, number];

        // When scaling Y (height), adjust position to keep bottom anchored
        if (axis === 1) {
          const baseY = getShapeBaseSize(s)[1];
          const oldHeight = s.scale[1] * baseY;
          const newHeight = clampedValue * baseY;
          const heightDiff = newHeight - oldHeight;
          return {
            ...s,
            scale: newScale,
            position: [
              s.position[0],
              s.position[1] + heightDiff / 2,
              s.position[2],
            ] as [number, number, number],
          };
        }

        return { ...s, scale: newScale };
      }),
    );
  };

  const alignShapes = (axis: "x" | "y" | "z") => {
    if (selectedIds.length < 2) return;
    const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const refPos = selectedShapes[0].position[axisIdx];
    saveToHistory(
      shapes.map((s) =>
        selectedIds.includes(s.id) && !s.isLocked
          ? {
              ...s,
              position: s.position.map((p, i) =>
                i === axisIdx ? refPos : p,
              ) as [number, number, number],
            }
          : s,
      ),
    );
  };

  const appendProject = (
    newShapes: ShapeType[],
    newPaths: MotionPath[],
    newGroups: GroupType[],
    newMotorGroups: MotorGroup[],
  ) => {
    let maxId = 0;
    shapes.forEach((s) => {
      if (s.id > maxId) maxId = s.id;
    });
    paths.forEach((p) => {
      if (p.id > maxId) maxId = p.id;
    });
    groups.forEach((g) => {
      if (g.id > maxId) maxId = g.id;
    });
    motorGroups.forEach((m) => {
      if (m.id > maxId) maxId = m.id;
    });

    const offset = Math.max(maxId, 5000) + 1000;

    const mappedShapes = newShapes.map((s) => ({
      ...s,
      id: s.id + offset,
      parentId: s.parentId !== undefined ? s.parentId + offset : undefined,
      pathId: s.pathId !== undefined ? s.pathId + offset : undefined,
    }));

    const mappedPaths = newPaths.map((p) => ({
      ...p,
      id: p.id + offset,
    }));

    const mappedGroups = newGroups.map((g) => ({
      ...g,
      id: g.id + offset,
      parentGroupId:
        g.parentGroupId !== undefined ? g.parentGroupId + offset : undefined,
      pivotShapeId:
        g.pivotShapeId !== undefined ? g.pivotShapeId + offset : undefined,
    }));

    const mappedMotorGroups = newMotorGroups.map((mg) => ({
      ...mg,
      id: mg.id + offset,
      shapeIds: mg.shapeIds.map((id) => id + offset),
      pivotShapeId:
        mg.pivotShapeId !== undefined ? mg.pivotShapeId + offset : undefined,
    }));

    saveToHistory(
      [...shapes, ...mappedShapes],
      [...paths, ...mappedPaths],
      [...groups, ...mappedGroups],
      [...motorGroups, ...mappedMotorGroups],
    );
    setSelectedIds([]);
    setSelectedPathId(null);
  };

  const importProject = (
    newShapes: ShapeType[],
    newPaths: MotionPath[],
    newGroups?: GroupType[],
    newMotorGroups?: MotorGroup[],
    importedName?: string,
  ) => {
    if (shapes.length > 0) {
      setPendingImport({
        shapes: newShapes,
        paths: newPaths,
        groups: newGroups || [],
        motorGroups: newMotorGroups || [],
        projectName: importedName,
      });
    } else {
      saveToHistory(newShapes, newPaths, newGroups || [], newMotorGroups || []);
      setSelectedIds([]);
      setSelectedPathId(null);
      if (importedName) setProjectName(importedName);
    }
  };

  const exportProject = () => {
    const data = JSON.stringify({ shapes, groups, paths, motorGroups });
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadDemoCar = () => {
    if (shapes.length === 0 && paths.length === 0) {
      confirmLoadDemoCar();
      return;
    }
    setShowDemoCarConfirm(true);
  };

  const confirmLoadDemoCar = () => {
    setShowDemoCarConfirm(false);
    const chassisId = 1001;
    const flWheelId = 1002;
    const frWheelId = 1003;
    const rlWheelId = 1004;
    const rrWheelId = 1005;
    const flKnuckleId = 1006;
    const frKnuckleId = 1007;
    const chassisGroupId = 3001;
    const bodyPartDefaults = {
      parentId: chassisGroupId,
      groupType: "standard" as const,
      isLocked: false,
      isHole: false,
      friction: 0.55,
      restitution: 0.08,
    };

    const newShapes: ShapeType[] = [
      {
        id: chassisId,
        name: "Main Chassis",
        type: "cube",
        position: [0, 5.0, 0],
        rotation: [0, 0, 0],
        scale: [10.0, 2.0, 16.0],
        color: "#dc2626",
        mass: 280,
        ...bodyPartDefaults,
      },
      {
        id: 1008,
        name: "Front Hood",
        type: "cube",
        position: [0, 6.2, 6.0],
        rotation: [-0.1, 0, 0],
        scale: [9.5, 1.2, 5.5],
        color: "#ef4444",
        mass: 55,
        ...bodyPartDefaults,
      },
      {
        id: 1009,
        name: "Rear Trunk",
        type: "cube",
        position: [0, 6.0, -7.0],
        rotation: [0.05, 0, 0],
        scale: [9.0, 1.1, 4.5],
        color: "#b91c1c",
        mass: 45,
        ...bodyPartDefaults,
      },
      {
        id: 1010,
        name: "Passenger Cabin",
        type: "cube",
        position: [0, 8.5, -1.5],
        rotation: [0, 0, 0],
        scale: [6.0, 3.8, 5.5],
        color: "#991b1b",
        mass: 85,
        ...bodyPartDefaults,
      },
      {
        id: 1011,
        name: "Front Windshield",
        type: "cube",
        position: [0, 9.2, 1.5],
        rotation: [-0.4, 0, 0],
        scale: [5.5, 0.35, 2.5],
        color: "#38bdf8",
        mass: 8,
        ...bodyPartDefaults,
      },
      {
        id: 1012,
        name: "Rear Window",
        type: "cube",
        position: [0, 8.9, -4.5],
        rotation: [0.35, 0, 0],
        scale: [5.0, 0.35, 2.0],
        color: "#0ea5e9",
        mass: 8,
        ...bodyPartDefaults,
      },
      {
        id: 1013,
        name: "Left Side Skirt",
        type: "cube",
        position: [-5.5, 4.2, 0],
        rotation: [0, 0, 0],
        scale: [0.8, 1.4, 17.5],
        color: "#0f172a",
        mass: 40,
        ...bodyPartDefaults,
      },
      {
        id: 1014,
        name: "Right Side Skirt",
        type: "cube",
        position: [5.5, 4.2, 0],
        rotation: [0, 0, 0],
        scale: [0.8, 1.4, 17.5],
        color: "#0f172a",
        mass: 40,
        ...bodyPartDefaults,
      },
      {
        id: 1015,
        name: "Front Bumper",
        type: "cube",
        position: [0, 4.3, 9.5],
        rotation: [0, 0, 0],
        scale: [11.0, 1.4, 1.0],
        color: "#334155",
        mass: 30,
        ...bodyPartDefaults,
      },
      {
        id: 1016,
        name: "Rear Bumper",
        type: "cube",
        position: [0, 4.3, -9.5],
        rotation: [0, 0, 0],
        scale: [10.5, 1.4, 1.0],
        color: "#334155",
        mass: 30,
        ...bodyPartDefaults,
      },
      {
        id: 1017,
        name: "Left Headlight",
        type: "cube",
        position: [-2.8, 5.2, 10.2],
        rotation: [0, 0, 0],
        scale: [1.8, 0.8, 0.35],
        color: "#fde68a",
        mass: 4,
        ...bodyPartDefaults,
      },
      {
        id: 1018,
        name: "Right Headlight",
        type: "cube",
        position: [2.8, 5.2, 10.2],
        rotation: [0, 0, 0],
        scale: [1.8, 0.8, 0.35],
        color: "#fde68a",
        mass: 4,
        ...bodyPartDefaults,
      },
      {
        id: 1019,
        name: "Left Taillight",
        type: "cube",
        position: [-2.8, 5.2, -10.2],
        rotation: [0, 0, 0],
        scale: [1.5, 0.7, 0.3],
        color: "#ef4444",
        mass: 3,
        ...bodyPartDefaults,
      },
      {
        id: 1020,
        name: "Right Taillight",
        type: "cube",
        position: [2.8, 5.2, -10.2],
        rotation: [0, 0, 0],
        scale: [1.5, 0.7, 0.3],
        color: "#ef4444",
        mass: 3,
        ...bodyPartDefaults,
      },
      {
        id: 1021,
        name: "Roof",
        type: "cube",
        position: [0, 10.5, -1.5],
        rotation: [0, 0, 0],
        scale: [6.2, 0.3, 5.6],
        color: "#7f1d1d",
        mass: 15,
        ...bodyPartDefaults,
      },
      {
        id: flKnuckleId,
        name: "FL Steering Knuckle",
        type: "cube",
        position: [-5.5, 4.0, 6.5],
        rotation: [0, 0, 0],
        scale: [1.2, 1.2, 1.2],
        color: "#64748b",
        isLocked: false,
        isHole: false,
        mass: 8,
        friction: 0.5,
        restitution: 0.1,
      },
      {
        id: frKnuckleId,
        name: "FR Steering Knuckle",
        type: "cube",
        position: [5.5, 4.0, 6.5],
        rotation: [0, 0, 0],
        scale: [1.2, 1.2, 1.2],
        color: "#64748b",
        isLocked: false,
        isHole: false,
        mass: 8,
        friction: 0.5,
        restitution: 0.1,
      },
      {
        id: flWheelId,
        name: "Front Left Wheel",
        type: "cylinder",
        position: [-6.8, 4.0, 6.5],
        rotation: [0, 0, Math.PI / 2],
        scale: [5.5, 1.8, 5.5],
        color: "#1e293b",
        isLocked: false,
        isHole: false,
        mass: 45,
        friction: 0.85,
        restitution: 0.1,
      },
      {
        id: frWheelId,
        name: "Front Right Wheel",
        type: "cylinder",
        position: [6.8, 4.0, 6.5],
        rotation: [0, 0, Math.PI / 2],
        scale: [5.5, 1.8, 5.5],
        color: "#1e293b",
        isLocked: false,
        isHole: false,
        mass: 45,
        friction: 0.85,
        restitution: 0.1,
      },
      {
        id: rlWheelId,
        name: "Rear Left Wheel",
        type: "cylinder",
        position: [-6.8, 4.0, -6.5],
        rotation: [0, 0, Math.PI / 2],
        scale: [5.5, 1.8, 5.5],
        color: "#1e293b",
        isLocked: false,
        isHole: false,
        mass: 45,
        friction: 0.85,
        restitution: 0.1,
      },
      {
        id: rrWheelId,
        name: "Rear Right Wheel",
        type: "cylinder",
        position: [6.8, 4.0, -6.5],
        rotation: [0, 0, Math.PI / 2],
        scale: [5.5, 1.8, 5.5],
        color: "#1e293b",
        isLocked: false,
        isHole: false,
        mass: 45,
        friction: 0.85,
        restitution: 0.1,
      },
    ];

    const newGroups: GroupType[] = [
      {
        id: chassisGroupId,
        name: "Vehicle Chassis Group",
      },
    ];

    const newMotorGroups: MotorGroup[] = [
      {
        id: 2001,
        name: "Rear Drive Motor",
        shapeIds: [chassisId, rlWheelId, rrWheelId],
        pivotShapeId: chassisId,
        jointAxis: "x",
        vehicleRole: "drive",
      },
      {
        id: 2002,
        name: "Front Drive Motor",
        shapeIds: [chassisId, flWheelId, frWheelId],
        pivotShapeId: chassisId,
        jointAxis: "x",
        vehicleRole: "drive",
      },
      {
        id: 2003,
        name: "FL Steering Motor",
        shapeIds: [chassisId, flKnuckleId],
        pivotShapeId: chassisId,
        jointAxis: "y",
        vehicleRole: "steer",
      },
      {
        id: 2004,
        name: "FR Steering Motor",
        shapeIds: [chassisId, frKnuckleId],
        pivotShapeId: chassisId,
        jointAxis: "y",
        vehicleRole: "steer",
      },
    ];

    saveToHistory(newShapes, [], newGroups, newMotorGroups);
    setSelectedIds([]);
    setSelectedPathId(null);
  };

  const updateMotion = (
    id: number,
    channelId?: string,
    type?: "motor" | "xyz_rotation" | "linear",
    inverted?: boolean,
    jointAxis?: "x" | "y" | "z" | "xyz",
  ) => {
    saveToHistory(
      shapes.map((s) => {
        if (s.id !== id || s.isLocked) return s;
        return {
          ...s,
          motionChannelId:
            channelId !== undefined ? channelId : s.motionChannelId,
          motionType: type !== undefined ? type : s.motionType,
          motionInverted: inverted !== undefined ? inverted : s.motionInverted,
          jointAxis: jointAxis !== undefined ? jointAxis : s.jointAxis,
        };
      }),
    );
  };

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-slate-950 font-sans text-slate-200 select-none">
      <div className="min-h-9 bg-slate-800 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-y-1 py-1 px-3 z-20 shrink-0 select-none">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1.5 group">
            {isEditingName ? (
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setIsEditingName(false);
                }}
                autoFocus
                className="bg-slate-950 border border-indigo-500 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-100 outline-none w-40"
              />
            ) : (
              <div
                onClick={() => setIsEditingName(true)}
                className="text-[12px] font-semibold text-slate-300 hover:text-white cursor-pointer flex items-center gap-1 py-0.5 px-1.5 rounded hover:bg-slate-800 transition-colors"
              >
                {projectName}
                <Edit size={16} className="transition-opacity text-white" />
              </div>
            )}
          </div>
          {cadStreamConnected && (
            <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
              <span className="w-1 h-1 bg-indigo-400 rounded-full" />
              Sim Stream Active
            </span>
          )}
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <button
            disabled={selectedIds.length === 0}
            onClick={handleCopy}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Copy Object"
          >
            <Copy size={11} />
          </button>
          <button
            disabled={copiedShapes.length === 0}
            onClick={handlePaste}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Paste Object"
          >
            <Clipboard size={11} />
          </button>
          <button
            disabled={selectedIds.length === 0}
            onClick={duplicateShape}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Duplicate Object"
          >
            <CopyPlus size={11} />
          </button>
          <button
            disabled={selectedIds.length === 0}
            onClick={deleteSelectedShapes}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-red-400 hover:text-red-300 hover:border-red-900/50 hover:bg-red-950/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Delete Object"
          >
            <Trash2 size={11} />
          </button>
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <button
            disabled={history.current.length === 0}
            onClick={undo}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Undo"
          >
            <Undo2 size={11} />
          </button>
          <button
            disabled={redoStack.current.length === 0}
            onClick={redo}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Redo"
          >
            <Redo2 size={11} />
          </button>
        </div>
        <div className="flex items-center bg-slate-950 border border-slate-600 rounded-lg p-0.5 shadow-sm">
          {(["translate", "rotate", "scale", "drawPath", "erase"] as const).map(
            (m) => {
              const active = mode === m;
              const icons = {
                translate: <Move size={11} />,
                rotate: <RotateCw size={11} />,
                scale: <Maximize2 size={11} />,
                drawPath: <PenTool size={11} />,
                erase: <Eraser size={11} />,
              };
              const labels = {
                translate: "Move",
                rotate: "Rotate",
                scale: "Scale",
                drawPath: "Draw Path",
                erase: "Boolean Erase",
              };
              return (
                <button
                  key={m}
                  onClick={() => {
                    if (m === "drawPath") {
                      const alreadyInDrawMode = mode === "drawPath";
                      if (paths.length === 0 || alreadyInDrawMode) {
                        const nid = Date.now();
                        let index = 1;
                        while (paths.some((p) => p.name === `Path ${index}`)) {
                          index++;
                        }
                        const nextName = `Path ${index}`;
                        saveToHistory(undefined, [
                          ...paths,
                          {
                            id: nid,
                            name: nextName,
                            points: [],
                            closed: false,
                          },
                        ]);
                        setSelectedPathId(nid);
                      } else if (
                        selectedPathId === null ||
                        !paths.some((p) => p.id === selectedPathId)
                      ) {
                        setSelectedPathId(paths[paths.length - 1].id);
                      }
                    }
                    setMode(m);
                  }}
                  className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 border-0 ${
                    active
                      ? "bg-indigo-600/90 text-white shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                  title={labels[m]}
                >
                  {icons[m]}
                  <span className="hidden md:inline">
                    {m === "drawPath" ? "Path" : m === "erase" ? "Erase" : m}
                  </span>
                </button>
              );
            },
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            disabled={
              selectedIds.length < 2 ||
              shapes.some((s) => selectedIds.includes(s.id) && s.isLocked)
            }
            onClick={groupShapes}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Add Objects"
          >
            <Layers size={11} />
          </button>
          <button
            disabled={
              !shapes.some((s) => selectedIds.includes(s.id) && s.parentId)
            }
            onClick={ungroupShapes}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Ungroup Objects"
          >
            <Ungroup size={11} />
          </button>
          <button
            disabled={
              selectedIds.length < 2 ||
              shapes.some((s) => selectedIds.includes(s.id) && s.isLocked)
            }
            onClick={subtractShapes}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-600 text-slate-200 hover:text-white hover:border-indigo-500 hover:bg-slate-800 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Subtract Boolean"
          >
            <Scissors size={11} />
          </button>
          <div className="flex items-center bg-slate-950 border border-slate-600 rounded-lg p-0.5 h-7 shadow-sm">
            {(["x", "y", "z"] as const).map((axis) => (
              <button
                key={axis}
                disabled={selectedIds.length < 2}
                onClick={() => alignShapes(axis)}
                className="px-2 py-0.5 text-[8px] font-bold text-slate-300 hover:text-white rounded disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors border-0 bg-transparent"
                title={`Align ${axis.toUpperCase()}`}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <input
            type="file"
            accept=".json"
            ref={importInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (event) => {
                try {
                  const data = JSON.parse(event.target?.result as string);
                  if (data.shapes && Array.isArray(data.paths))
                    importProject(
                      data.shapes,
                      data.paths,
                      data.groups || [],
                      data.motorGroups || [],
                      file.name.replace(/\.json$/i, ""),
                    );
                } catch (err) {
                  console.error("Load failed", err);
                }
              };
              reader.readAsText(file);
              e.target.value = "";
            }}
            className="hidden"
          />
          <button
            onClick={triggerImport}
            className="bg-slate-950 border border-slate-600 hover:bg-slate-800 hover:border-indigo-500 text-slate-200 hover:text-white font-semibold text-[10px] py-1 px-2 rounded-lg cursor-pointer transition-all flex items-center gap-1 h-7 shadow-sm"
            title="Import JSON Project"
          >
            <Upload size={11} />
            <span className="hidden lg:inline">Import</span>
          </button>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value === "json") exportProject();
              else if (e.target.value === "stl")
                window.dispatchEvent(new Event("trigger-stl-export"));
              else if (e.target.value === "glb")
                window.dispatchEvent(new Event("trigger-glb-export"));
              e.target.value = "";
            }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10px] px-2 rounded-lg border-0 cursor-pointer shadow-md focus:outline-none flex items-center justify-center h-7"
          >
            <option value="" disabled>
              Export
            </option>
            <option value="json" className="bg-slate-900 text-white">
              Save Progess
            </option>
            <option value="stl" className="bg-slate-900 text-white">
              STL (3D Printing)
            </option>
            <option value="glb" className="bg-slate-900 text-white">
              Save As GLB
            </option>
          </select>
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <button
            onClick={() =>
              navigate("/simulation", {
                state: { shapes, groups, motorGroups, paths },
              })
            }
            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] uppercase tracking-wider py-1 px-2.5 rounded-lg shadow-md cursor-pointer transition-all border-0 h-7"
          >
            <Play size={10} fill="currentColor" />
            Simulate
          </button>
          <button
            onClick={loadDemoCar}
            className="flex items-center gap-1 bg-slate-950 hover:bg-slate-800 hover:border-indigo-500 text-slate-200 hover:text-white border border-slate-600 font-bold text-[10px] uppercase tracking-wider py-1 px-2 rounded-lg cursor-pointer transition-all h-7 shadow-sm"
          >
            <Sparkles size={10} className="text-amber-400" />
            Load Demo Car
          </button>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden relative">
        <Canvas3D
          shapes={shapes}
          groups={groups}
          motorGroups={motorGroups}
          setSelectedIds={setSelectedIds}
          selectedIds={selectedIds}
          setShapes={setShapes}
          mode={mode}
          snapToGrid={snapToGrid}
          snapIncrement={snapIncrement}
          gridSize={gridSize}
          paths={paths}
          setPaths={setPaths}
          selectedPathId={selectedPathId}
          setSelectedPathId={setSelectedPathId}
          selectedPathIds={selectedPathIds}
          showPaths={showPaths}
          drawingAltitude={drawingAltitude}
          wsSettings={wsSettings}
          setWsSettings={setWsSettings}
          activePathWP={activePathWP}
          setActivePathWP={setActivePathWP}
          savePathsToHistory={saveToHistory}
          simulationFrame={liveSimulationFrame}
          brushSize={brushSize}
          brushShape={brushShape}
          scaleFromSide={scaleFromSide}
          motionController={motionController.current}
          addShape={addShape}
          addGlbShape={addGlbShape}
          placementRequest={placementRequest}
          setPlacementRequest={setPlacementRequest}
          meshRefs={meshRefs}
        />
        <RightPanel
          startPlacement={setPlacementRequest}
          customAssets={customAssets}
          addCustomAsset={addCustomAsset}
          removeCustomAsset={removeCustomAsset}
          snapToGrid={snapToGrid}
          setSnapToGrid={setSnapToGrid}
          snapIncrement={snapIncrement}
          setSnapIncrement={setSnapIncrement}
          openSettingsModal={() => setWsOpen(true)}
          paths={paths}
          setPaths={(newPaths) => saveToHistory(undefined, newPaths)}
          deletePath={deletePath}
          attachedPathIds={attachedPathIds}
          selectedPathId={selectedPathId}
          setSelectedPathId={setSelectedPathId}
          showPaths={showPaths}
          setShowPaths={setShowPaths}
          mode={mode}
          setMode={setMode}
          drawingAltitude={drawingAltitude}
          setDrawingAltitude={setDrawingAltitude}
          activePathWP={activePathWP}
        />
        {mode === "drawPath" &&
          (() => {
            const activePath = paths.find((p) => p.id === selectedPathId);
            if (!activePath) return null;
            return (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-[20] w-[280px] bg-slate-900/90 border border-slate-700/60 rounded-xl shadow-xl backdrop-blur-md px-3 py-2.5 flex flex-col gap-2 transition-all duration-200 animate-in fade-in slide-in-from-top-3 select-none"
              >
                {/* Active Path Header Row with Rename/Toggle/Delete controls */}
                <div className="flex items-center gap-1.5">
                  {isEditingPathName ? (
                    <input
                      type="text"
                      className="flex-1 min-w-0 bg-slate-950/85 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 text-[10px] focus:outline-none focus:border-indigo-500 font-semibold"
                      value={activePath.name || ""}
                      onChange={(e) =>
                        saveToHistory(
                          undefined,
                          paths.map((p2) =>
                            p2.id === activePath.id
                              ? { ...p2, name: e.target.value }
                              : p2,
                          ),
                        )
                      }
                      onBlur={() => setIsEditingPathName(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setIsEditingPathName(false);
                      }}
                      autoFocus
                      placeholder="Path Name"
                      title="Rename Path"
                    />
                  ) : (
                    <select
                      className="flex-1 min-w-0 bg-slate-950/85 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 text-[10px] focus:outline-none focus:border-indigo-500 font-semibold cursor-pointer"
                      value={selectedPathId || ""}
                      onChange={(e) =>
                        setSelectedPathId(Number(e.target.value))
                      }
                      title="Select Active Path"
                    >
                      {paths.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          className="bg-slate-900 text-slate-200"
                        >
                          {p.name || `Path ${p.id.toString().slice(-4)}`}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Edit path name toggle button */}
                  <button
                    className={`w-5 h-5 shrink-0 flex items-center justify-center rounded border cursor-pointer transition-all border-0 ${
                      isEditingPathName
                        ? "bg-emerald-600/30 border-emerald-500/40 text-emerald-300"
                        : "bg-slate-950/45 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                    }`}
                    onClick={() => setIsEditingPathName(!isEditingPathName)}
                    title={isEditingPathName ? "Save Name" : "Rename Path"}
                  >
                    <Edit size={10} />
                  </button>

                  {/* Loop toggle */}
                  <button
                    disabled={attachedPathIds.has(activePath.id)}
                    className={`w-5 h-5 shrink-0 flex items-center justify-center rounded border cursor-pointer text-[9px] transition-all border-0 disabled:opacity-30 disabled:cursor-not-allowed ${
                      activePath.closed
                        ? "bg-indigo-600/30 border-indigo-500/40 text-indigo-300"
                        : "bg-slate-950/45 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                    }`}
                    onClick={() =>
                      saveToHistory(
                        undefined,
                        paths.map((p2) =>
                          p2.id === activePath.id
                            ? { ...p2, closed: !p2.closed }
                            : p2,
                        ),
                      )
                    }
                    title={
                      attachedPathIds.has(activePath.id)
                        ? "Detach the object first to edit this path"
                        : activePath.closed
                          ? "Loop Enabled"
                          : "Loop Disabled"
                    }
                  >
                    {activePath.closed ? "⊚" : "≬"}
                  </button>

                  {/* Hide / Show toggle */}
                  <button
                    className={`w-5 h-5 shrink-0 flex items-center justify-center rounded border cursor-pointer text-[10px] transition-all border-0 ${
                      showPaths
                        ? "bg-slate-950/45 border-slate-800 text-slate-300 hover:bg-slate-800"
                        : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                    }`}
                    onClick={() => setShowPaths(!showPaths)}
                    title={showPaths ? "Hide Paths" : "Show Paths"}
                  >
                    {showPaths ? "👁" : "👁‍🗨"}
                  </button>

                  {/* Delete button */}
                  <button
                    className="w-5 h-5 shrink-0 flex items-center justify-center rounded border border-0 cursor-pointer bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                    onClick={() => {
                      deletePath(activePath.id);
                      setSelectedPathId(null);
                    }}
                    title="Delete Path"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>

                {/* Waypoint information & Altitude display */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mt-1">
                  <span>
                    {activePathWP !== null
                      ? `Waypoint #${activePathWP + 1}`
                      : "No Waypoint selected"}
                  </span>
                  <span>
                    Y:{" "}
                    <span className="text-indigo-400 font-bold">
                      {drawingAltitude.toFixed(1)} mm
                    </span>
                  </span>
                </div>

                {/* Altitude Slider */}
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] text-slate-500 font-bold">
                      0
                    </span>
                    <input
                      type="range"
                      className="flex-1 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
                      min="0"
                      max="30"
                      step="0.5"
                      value={drawingAltitude}
                      onChange={(e) =>
                        setDrawingAltitude(Number(e.target.value))
                      }
                    />
                    <span className="text-[8px] text-slate-500 font-bold">
                      30
                    </span>
                  </div>

                  {/* Done button */}
                  <button
                    className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] uppercase tracking-wider transition-colors cursor-pointer border-0 shadow-sm"
                    onClick={() => setMode("translate")}
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })()}
        {selectedIds.length > 0 && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 right-[17vw] z-[15] w-[290px] bg-slate-900/95 border border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden max-h-[85vh] flex flex-col transition-all duration-200 animate-in fade-in slide-in-from-top-3 duration-250"
          >
            <div className="py-2.5 px-3.5 border-b border-slate-850 flex items-center justify-between bg-slate-950/40 select-none shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Inspector Properties
              </span>
              <button
                onClick={() => setSelectedIds([])}
                className="text-slate-500 hover:text-slate-300 font-bold text-sm cursor-pointer border-0 bg-transparent focus:outline-none"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
              <InspectorSection
                selectedShapes={selectedShapes}
                primarySelected={primarySelected}
                toggleLock={toggleLock}
                toggleGripper={toggleGripper}
                toggleGripping={toggleGripping}
                toggleGrabbable={toggleGrabbable}
                updateGripOffset={updateGripOffset}
                duplicateShape={duplicateShape}
                deleteShape={deleteSelectedShapes}
                flattenGroup={flattenGroup}
                groupShapes={groupShapes}
                ungroupShapes={ungroupShapes}
                subtractShapes={subtractShapes}
                alignShapes={alignShapes}
                paths={paths}
                attachToPath={attachToPath}
                detachFromPath={detachFromPath}
                updatePathSpeed={updatePathSpeed}
                toggleHole={toggleHole}
                updateColor={updateColor}
                updateTexture={updateTexture}
                updateScale={updateScale}
                updateRotation={updateRotation}
                scale={wsSettings.scale}
                unitMode={
                  wsSettings.scale === "1:1"
                    ? "mm"
                    : wsSettings.scale === "1:10"
                      ? "cm"
                      : "m"
                }
                motorGroups={motorGroups}
                setSelectedIds={setSelectedIds}
                updateShapePhysicsProperty={updateShapePhysicsProperty}
              />
              <div className="flex flex-col gap-2.5 mt-2 border-t border-slate-800 pt-3 select-none">
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/30 border border-slate-800 hover:border-slate-700/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-300">
                      🔌 Circuit Stream Link
                    </span>
                  </div>
                  <div
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-300 ${
                      enableCircuitLink ? "bg-indigo-600" : "bg-slate-700"
                    }`}
                    onClick={() => {
                      const next = !enableCircuitLink;
                      setEnableCircuitLink(next);
                      if (!next) {
                        setPrimaryCircuitNodeId("");
                      }
                    }}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                        enableCircuitLink ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </div>
                </div>
                {enableCircuitLink && (
                  <div className="p-2.5 rounded-lg bg-slate-950/50 border border-indigo-500/10 animate-in slide-in-from-top-2 duration-200">
                    <CircuitSection
                      circuitLinkOptions={circuitLinkOptions}
                      cadStreamConnected={cadStreamConnected}
                      liveSimulationFrame={liveSimulationFrame}
                      primarySelected={primarySelected}
                      setPrimaryCircuitNodeId={setPrimaryCircuitNodeId}
                      lastCircuitStartPayload={lastCircuitStartPayload}
                      unitMode={wsSettings.scale === "1:1" ? "mm" : "cm"}
                      streamHostLabel={SIMULATION_SERVER_LABEL}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/30 border border-slate-800 hover:border-slate-700/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-300">
                      ⚙️ Motion & Joint Controls
                    </span>
                  </div>
                  <div
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-300 ${
                      enableMotionControls ? "bg-emerald-600" : "bg-slate-700"
                    }`}
                    onClick={() =>
                      setEnableMotionControls(!enableMotionControls)
                    }
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                        enableMotionControls ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </div>
                </div>
                {enableMotionControls && (
                  <div className="p-2.5 rounded-lg bg-slate-950/50 border border-emerald-500/10 animate-in slide-in-from-top-2 duration-200">
                    <MotionControlSection
                      shapes={shapes}
                      selectedShapes={selectedShapes}
                      primarySelected={primarySelected}
                      groups={groups}
                      motionController={motionController.current}
                      updateMotion={updateMotion}
                      makeSelectedGroupJoint={makeSelectedGroupJoint}
                      updateSelectedGroupJointRotation={
                        updateSelectedGroupJointRotation
                      }
                      updateGroupJointRotationById={
                        updateGroupJointRotationById
                      }
                      updateSelectedGroupPivot={updateSelectedGroupPivot}
                      updateSelectedGroupPivotShapeId={
                        updateSelectedGroupPivotShapeId
                      }
                      updateGroupMotion={updateGroupMotion}
                      setSelectedIds={setSelectedIds}
                      ungroupShapes={ungroupShapes}
                      motorGroups={motorGroups}
                      createMotorGroup={createMotorGroup}
                      updateMotorGroupShapes={updateMotorGroupShapes}
                      updateMotorGroupMotion={updateMotorGroupMotion}
                      deleteMotorGroup={deleteMotorGroup}
                      updateMotorGroupPivot={updateMotorGroupPivot}
                      updateMotorGroupAxis={updateMotorGroupAxis}
                      updateMotorGroupLimits={updateMotorGroupLimits}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {mode === "erase" && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[15] bg-red-950/90 border border-red-500/50 rounded-xl p-3 flex flex-col gap-2 shadow-xl backdrop-blur-sm max-w-sm animate-in zoom-in-95 duration-200"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
              <Eraser size={14} />
              Boolean Erase Active
            </div>
            <div className="flex flex-col gap-2 mt-1">
              <div>
                <div className="flex justify-between items-center text-[10px] mb-1.5 text-slate-400">
                  <span>Brush Size (mm)</span>
                  <input
                    type="number"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={brushSize}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        setBrushSize(Math.max(0.1, val));
                      }
                    }}
                    className="w-14 bg-black/45 border border-red-500/30 rounded px-1.5 py-0.5 text-red-200 text-[10px] text-right focus:outline-none focus:border-red-500 font-semibold"
                  />
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseFloat(e.target.value))}
                  className="w-full accent-red-500 h-1 rounded bg-slate-800"
                />
              </div>
              <div>
                <div className="text-[10px] mb-1 text-slate-400">
                  Brush Shape
                </div>
                <div className="flex gap-1.5">
                  <button
                    className={`flex-1 py-1 px-2.5 rounded border text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                      brushShape === "sphere"
                        ? "bg-red-500/20 border-red-500 text-red-300"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                    }`}
                    onClick={() => setBrushShape("sphere")}
                  >
                    Sphere
                  </button>
                  <button
                    className={`flex-1 py-1 px-2.5 rounded border text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                      brushShape === "cube"
                        ? "bg-red-500/20 border-red-500 text-red-300"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                    }`}
                    onClick={() => setBrushShape("cube")}
                  >
                    Cube
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <WorkspaceSettingsModal
        open={wsOpen}
        onClose={() => setWsOpen(false)}
        settings={wsSettings}
        onChange={(s) => {
          setWsSettings(s);
          saveWsSettings(s);
        }}
      />
      {csgError && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fee2e2",
            color: "#991b1b",
            border: "2px solid #ef4444",
            padding: "12px 24px",
            borderRadius: "8px",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.2)",
            fontFamily: "sans-serif",
            fontSize: "14px",
            fontWeight: 500,
          }}
        >
          <span>{csgError}</span>
          <button
            onClick={() => setCsgError(null)}
            style={{
              background: "#991b1b",
              border: "none",
              color: "#ffffff",
              cursor: "pointer",
              fontWeight: "bold",
              borderRadius: "4px",
              width: "20px",
              height: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
            }}
          >
            ✕
          </button>
        </div>
      )}
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200 text-left">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Clear Canvas
            </h3>
            <p
              className="text-sm text-slate-600 mb-6 whitespace-normal"
              style={{ fontFamily: "sans-serif" }}
            >
              Are you sure you want to clear everything (shapes and paths)? This
              action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearCanvas}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
      {showDemoCarConfirm && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200 text-left">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Load Demo Car
            </h3>
            <p
              className="text-sm text-slate-600 mb-6 whitespace-normal"
              style={{ fontFamily: "sans-serif" }}
            >
              Loading the demo car will replace your current design (shapes
              and paths). This action cannot be undone. Continue?
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDemoCarConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmLoadDemoCar}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
              >
                Load Demo Car
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingImport && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/80 backdrop-blur-[4px] animate-in fade-in duration-200"
          onClick={() => setPendingImport(null)}
          style={{ zIndex: 99999 }}
        >
          <div
            className="w-[420px] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200 text-slate-100 select-none text-left"
            onClick={(e) => e.stopPropagation()}
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-[13px] font-bold uppercase tracking-wider text-indigo-400">
                Import Design
              </span>
              <button
                onClick={() => setPendingImport(null)}
                className="text-slate-500 hover:text-slate-300 font-bold text-sm cursor-pointer border-0 bg-transparent focus:outline-none"
              >
                ✕
              </button>
            </div>

            {/* Description */}
            <div className="text-[11px] text-slate-400 leading-relaxed">
              How would you like to load{" "}
              <strong className="text-slate-200 font-semibold">
                "{pendingImport.projectName}"
              </strong>{" "}
              into your workspace?
            </div>

            {/* Actions Grid */}
            <div className="flex flex-col gap-2 mt-1">
              <button
                onClick={() => {
                  appendProject(
                    pendingImport.shapes,
                    pendingImport.paths,
                    pendingImport.groups,
                    pendingImport.motorGroups,
                  );
                  setPendingImport(null);
                }}
                className="w-full py-3 px-4 rounded-xl border border-indigo-500/20 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 hover:text-indigo-200 font-semibold text-xs transition-all duration-200 cursor-pointer flex flex-col items-center gap-1 group text-center"
              >
                <span className="font-bold text-[13px] group-hover:scale-[1.02] transition-transform">
                  Append to Current Canvas
                </span>
                <span className="text-[10px] text-slate-400 font-normal">
                  Adds the imported shapes, paths, and motors alongside your
                  current design.
                </span>
              </button>

              <button
                onClick={() => {
                  saveToHistory(
                    pendingImport.shapes,
                    pendingImport.paths,
                    pendingImport.groups,
                    pendingImport.motorGroups,
                  );
                  setSelectedIds([]);
                  setSelectedPathId(null);
                  if (pendingImport.projectName) {
                    setProjectName(pendingImport.projectName);
                  }
                  setPendingImport(null);
                }}
                className="w-full py-3 px-4 rounded-xl border border-slate-800 bg-slate-950/65 hover:bg-red-500/10 hover:border-red-500/30 text-slate-300 hover:text-red-200 font-semibold text-xs transition-all duration-200 cursor-pointer flex flex-col items-center gap-1 group text-center"
              >
                <span className="font-bold text-[13px] group-hover:scale-[1.02] transition-transform">
                  Replace Current Design
                </span>
                <span className="text-[10px] text-slate-400 font-normal">
                  Deletes everything in your current workspace and loads the new
                  file.
                </span>
              </button>
            </div>

            {/* Footer / Cancel */}
            <div className="flex justify-end border-t border-slate-800 pt-3">
              <button
                onClick={() => setPendingImport(null)}
                className="py-1.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 font-bold text-[10px] uppercase tracking-wider transition-colors cursor-pointer border-0"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CadStudio;
