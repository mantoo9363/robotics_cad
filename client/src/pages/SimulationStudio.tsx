import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { useLocation, useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";

import { Play, Pause, RotateCcw, ArrowLeft, Eye, HelpCircle, Shield, Settings2, ChevronDown, ChevronRight, Square, Zap, Sliders, Power, Move } from "lucide-react";
import type { ShapeType, GroupType, MotorGroup, MotionPath, CustomMember } from "../App";
import { loadWsSettings } from "../types/workspace";
import SimulationScene from "../components/canvas/SimulationScene";
import { getCircuitFrameMotionStats, type CircuitStreamFrame } from "../lib/circuitStream";
import { CAD_STREAM_URL } from "../lib/env";
import ErrorBoundary from "../components/ErrorBoundary";

// Shared by the four localStorage-backed useState initialisers below. Each was
// hand-rolling the same try/catch, except the `paths` one, which had none at
// all — a corrupt entry there threw inside a state initialiser and took the
// whole page down (docs/bug-audit-2026-08.md, BUG-044). Routing all four
// through one helper means a future reader can't reintroduce the asymmetry.
function readStoredJson<T>(key: string, pick: (parsed: any) => T, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const picked = pick(JSON.parse(raw));
    return picked === undefined || picked === null ? fallback : picked;
  } catch (err) {
    console.warn(
      `[SimulationStudio] localStorage["${key}"] is not valid JSON — falling back to empty. ` +
        `Clear that key to silence this.`,
      err,
    );
    return fallback;
  }
}

// DEV-only test hook — see the useEffect that assigns this below for why it
// exists (same convention as CadStudio.tsx's window.__csgTestRecolor and
// SimulationScene.tsx's window.__vehicleProbe).
declare global {
  interface Window {
    __csgTestEditCustomMembers?: (id: number, mutate: (members: CustomMember[]) => CustomMember[]) => void;
  }
}

export default function SimulationStudio() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as
    | {
        shapes?: ShapeType[];
        groups?: GroupType[];
        motorGroups?: MotorGroup[];
        paths?: MotionPath[];
      }
    | null;

  // Load CAD Studio state from localStorage
  const [shapes, setShapes] = useState<ShapeType[]>(() => {
    if (routeState && Array.isArray(routeState.shapes)) return routeState.shapes;
    return readStoredJson<ShapeType[]>("cad-studio-state", (p) => p.shapes, []);
  });

  // DEV-only test hook, same convention as CadStudio.tsx's
  // window.__csgTestRecolor. This page treats
  // `shapes` as effectively read-only in normal use (no setter existed
  // before this hook) — real customMembers edits only happen on the CAD
  // editor route, never while a body is an active dynamic simulation. To
  // exercise "a CSG-fold recompute happens while a shape is already a
  // simulated dynamic body" — the scenario Step 5's collider-safety-net
  // widening exists for — this lets a script mutate a shape's
  // customMembers in place, through the real setShapes path, so the
  // resulting re-render exercises MemberCollider.tsx/VoxelizedShapeBody.tsx
  // exactly as a live edit would if one were reachable from this page.
  useEffect(() => {
    if (!(process.env.NODE_ENV !== "production")) return;
    window.__csgTestEditCustomMembers = (id: number, mutate: (members: CustomMember[]) => CustomMember[]) => {
      setShapes((prev) =>
        prev.map((s) =>
          s.id === id && s.customMembers ? { ...s, customMembers: mutate(s.customMembers) } : s,
        ),
      );
    };
    return () => {
      delete window.__csgTestEditCustomMembers;
    };
  }, []);

  const [groups] = useState<GroupType[]>(() => {
    if (routeState && Array.isArray(routeState.groups)) return routeState.groups;
    return readStoredJson<GroupType[]>("cad-studio-state", (p) => p.groups, []);
  });

  const [motorGroups] = useState<MotorGroup[]>(() => {
    if (routeState && Array.isArray(routeState.motorGroups)) return routeState.motorGroups;
    return readStoredJson<MotorGroup[]>("cad-studio-state", (p) => p.motorGroups, []);
  });

  const [paths] = useState<MotionPath[]>(() => {
    if (routeState && Array.isArray(routeState.paths)) return routeState.paths;
    // Was a bare `JSON.parse(raw)` with no guard, unlike its three neighbours.
    return readStoredJson<MotionPath[]>("cad-studio-paths", (p) => p, []);
  });

  const [wsSettings] = useState(() => loadWsSettings());

  // Simulation Controls State
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [debugOutlines, setDebugOutlines] = useState<boolean>(false);
  const [gravity, setGravity] = useState<[number, number, number]>([0, -9.81, 0]);
  const [simulationKey, setSimulationKey] = useState<number>(0);
  const [liveSimulationFrame, setLiveSimulationFrame] = useState<CircuitStreamFrame | null>(null);
  const [cadStreamConnected, setCadStreamConnected] = useState(false);
  // Reported by the in-Canvas error boundary, which can't render DOM itself.
  const [sceneError, setSceneError] = useState<string | null>(null);
  // Count of malformed SSE frames dropped. A ref, not state: a bad frame must
  // not trigger a re-render of the whole simulation view, and this is only
  // read for diagnostics.
  const droppedFrameCountRef = useRef(0);

  useEffect(() => {
    const source = new EventSource(CAD_STREAM_URL);

    source.addEventListener("open", () => {
      setCadStreamConnected(true);
    });

    source.addEventListener("simulation-frame", (event) => {
      // One malformed frame from the external circuit server used to throw
      // straight out of this listener. Drop it and keep the stream alive
      // instead — the next good frame supersedes it anyway.
      let frame: CircuitStreamFrame;
      try {
        frame = JSON.parse((event as MessageEvent).data) as CircuitStreamFrame;
      } catch (err) {
        droppedFrameCountRef.current += 1;
        console.warn(
          `[SimulationStudio] dropped malformed simulation-frame ` +
            `(${droppedFrameCountRef.current} total this session):`,
          err,
        );
        return;
      }
      setLiveSimulationFrame(frame);
    });

    source.addEventListener("simulation-stop", () => {
      setLiveSimulationFrame(null);
    });

    source.addEventListener("error", () => {
      setCadStreamConnected(false);
    });

    return () => {
      source.close();
      setCadStreamConnected(false);
    };
  }, []);
  // Keyboard shortcut listener to trigger reset on 'R' key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "r" && !(e.target instanceof HTMLInputElement)) {
        setSimulationKey((prev) => prev + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleReset = () => {
    setSimulationKey((prev) => prev + 1);
  };

  // Custom motor speeds state â€” map of motorGroupId -> [x, y, z] velocity
  const [customMotorSpeeds, setCustomMotorSpeeds] = useState<Map<number, [number, number, number]>>(new Map());

  // Motor expansion state
  const [expandedMotors, setExpandedMotors] = useState<Record<number, boolean>>({});

  const isMotorExpanded = useCallback((id: number) => {
    return expandedMotors[id] !== false;
  }, [expandedMotors]);

  const toggleMotorExpand = useCallback((id: number) => {
    setExpandedMotors((prev) => ({
      ...prev,
      [id]: prev[id] === false,
    }));
  }, []);

  // Filter custom motors (not drive/steer)
  const customMotors = useMemo(
    () => motorGroups.filter((mg) => mg.vehicleRole !== "drive" && mg.vehicleRole !== "steer"),
    [motorGroups]
  );

  const setMotorSpeed = useCallback((mgId: number, axisIdx: number, value: number) => {
    setCustomMotorSpeeds((prev) => {
      const next = new Map(prev);
      const cur = next.get(mgId) || [0, 0, 0] as [number, number, number];
      const updated: [number, number, number] = [...cur];
      updated[axisIdx] = value;
      next.set(mgId, updated);
      return next;
    });
  }, []);

  const stopMotor = useCallback((mgId: number) => {
    setCustomMotorSpeeds((prev) => {
      const next = new Map(prev);
      next.set(mgId, [0, 0, 0]);
      return next;
    });
  }, []);

  const stopAllMotors = useCallback(() => {
    setCustomMotorSpeeds((prev) => {
      const next = new Map(prev);
      for (const mg of customMotors) {
        next.set(mg.id, [0, 0, 0]);
      }
      return next;
    });
  }, [customMotors]);

  const hasActiveMotors = useMemo(() => {
    for (const mg of customMotors) {
      const speed = customMotorSpeeds.get(mg.id);
      if (speed && (speed[0] !== 0 || speed[1] !== 0 || speed[2] !== 0)) {
        return true;
      }
    }
    return false;
  }, [customMotors, customMotorSpeeds]);

  const circuitMotionStats = useMemo(() => getCircuitFrameMotionStats(liveSimulationFrame), [liveSimulationFrame]);

  // Summarize drive and steering motor groups for status display
  const driveMotorsCount = motorGroups.filter((mg) => mg.vehicleRole === "drive").length;
  const steerMotorsCount = motorGroups.filter((mg) => mg.vehicleRole === "steer").length;

  return (
    <div className="flex w-full h-full overflow-hidden bg-[#090d16] font-sans text-slate-100">
      
      {/* â”€â”€ LEFT GLASSMORPHIC CONTROL PANEL â”€â”€ */}
      <div className="w-[340px] flex flex-col h-full bg-[#0f172a]/90 backdrop-blur-lg border-r border-white/10 z-10 shadow-[5px_0_25px_rgba(0,0,0,0.5)]">
        
        {/* Header Section */}
        <div className="p-4.5 border-b border-white/10 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => navigate("/")}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/15 text-slate-300 hover:text-slate-100 cursor-pointer transition-all duration-200"
            title="Back to CAD Editor"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-sm font-bold tracking-wider uppercase bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              PHYSICS LAB
            </h1>
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mt-0.5">
              Rapier Physics Engine
            </p>
          </div>
        </div>

        {/* Scrollable Content Container */}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col custom-scrollbar">
          {/* Simulation States */}
          <div className="p-4.5 flex flex-col gap-4 border-b border-white/5">
            <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500">
              Control Room
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs cursor-pointer border transition-all duration-250 shadow-md ${
                  isPlaying
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/15"
                    : "bg-amber-500/10 border-amber-500/40 text-amber-400 hover:bg-amber-500/15"
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause size={14} fill="currentColor" /> Pause Sim
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" /> Play Sim
                  </>
                )}
              </button>

              <button
                onClick={handleReset}
                className="flex-none w-11 h-10 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:border-slate-600 text-slate-300 hover:text-slate-100 cursor-pointer transition-all duration-200 shadow-md"
                title="Reset Simulation (Hotkey: R)"
              >
                <RotateCcw size={16} />
              </button>
            </div>

            {/* Outlines/Debug */}
            <label className="flex items-center justify-between p-3.5 bg-white/20 border border-white/5 rounded-xl cursor-pointer hover:bg-white/[0.04] hover:border-white/10 transition-all duration-200">
              <span className="flex items-center gap-2 text-xs text-slate-300 font-medium">
                <Eye size={14} className="text-indigo-400" />
                Show Physics Colliders
              </span>
              <div
                className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors duration-300 ${
                  debugOutlines ? "bg-indigo-600" : "bg-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={debugOutlines}
                  onChange={(e) => setDebugOutlines(e.target.checked)}
                  className="hidden"
                />
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                    debugOutlines ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </div>
            </label>
          </div>

          {/* Gravity Control Panel */}
          <div className="p-4.5 flex flex-col gap-3.5 border-b border-white/5">
            <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500">
              Gravity Vector (m/sÂ²)
            </div>

            {(["X", "Y", "Z"] as const).map((label, idx) => (
              <div key={label} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs text-slate-400 font-semibold">
                  <span>Axis {label}</span>
                  <span className={gravity[idx] !== 0 ? "text-indigo-400" : ""}>{gravity[idx].toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={idx === 1 ? "-20" : "-10"}
                    max={idx === 1 ? "20" : "10"}
                    step="0.1"
                    value={gravity[idx]}
                    onChange={(e) => {
                      const nextG = [...gravity] as [number, number, number];
                      nextG[idx] = Number(e.target.value);
                      setGravity(nextG);
                    }}
                    className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <button
                    onClick={() => {
                      const nextG = [...gravity] as [number, number, number];
                      nextG[idx] = idx === 1 ? -9.81 : 0;
                      setGravity(nextG);
                    }}
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Keyboard Driving Controls Help Card */}
          <div className="p-4.5 flex flex-col gap-3 border-b border-white/5">
            <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500">
              Keyboard Drive Commands
            </div>
            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                <HelpCircle size={14} /> Driving Hotkeys
              </div>
              
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Gas (Throttle)</span>
                  <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 font-mono rounded text-[10px]">W / Up Arrow</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Reverse (Back)</span>
                  <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 font-mono rounded text-[10px]">S / Down Arrow</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Steering</span>
                  <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 font-mono rounded text-[10px]">A, D / Left, Right</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Hand Brake</span>
                  <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 font-mono rounded text-[10px]">Spacebar</span>
                </div>
              </div>
            </div>
          </div>

          {/* Custom Motor Controls */}
          {customMotors.length > 0 && (
            <div className="p-4.5 flex flex-col gap-3.5 border-b border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings2 size={13} className="text-purple-400" />
                  <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500">
                    Custom Motor Controls
                  </div>
                </div>
                {hasActiveMotors && (
                  <button
                    onClick={stopAllMotors}
                    className="text-[9px] font-bold px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer flex items-center gap-1 transition-all duration-200 shadow-md shadow-red-500/5 hover:shadow-red-500/15"
                  >
                    <Power size={10} />
                    Stop All
                  </button>
                )}
              </div>

              {customMotors.map((mg) => {
                const speed = customMotorSpeeds.get(mg.id) || [0, 0, 0];
                const motionType = mg.motionType || "motor";
                const memberNames = shapes
                  .filter((s) => mg.shapeIds.includes(s.id))
                  .map((s) => s.name || `${s.type}#${s.id}`)
                  .join(", ");

                const isMotorActive = speed[0] !== 0 || speed[1] !== 0 || speed[2] !== 0;

                // Determine badge and color schema based on motionType
                let icon = <Zap size={12} />;
                let typeLabel = "Motor";

                if (motionType === "xyz_rotation") {
                  icon = <Sliders size={12} />;
                  typeLabel = "XYZ Rotate";
                } else if (motionType === "linear") {
                  icon = <Move size={12} />;
                  typeLabel = "Linear";
                }

                const expanded = isMotorExpanded(mg.id);

                return (
                  <div
                    key={mg.id}
                    className={`bg-gradient-to-br from-slate-900/60 to-slate-950/70 border rounded-xl overflow-hidden shadow-md transition-all duration-300 ${
                      isMotorActive 
                        ? motionType === "motor" 
                          ? "border-purple-500/25 shadow-[0_0_15px_rgba(168,85,247,0.06)]"
                          : motionType === "xyz_rotation"
                            ? "border-cyan-500/25 shadow-[0_0_15px_rgba(6,182,212,0.06)]"
                            : "border-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.06)]"
                        : "border-white/5 hover:border-white/10"
                    }`}
                  >
                    {/* Header Row (Toggles Collapse) */}
                    <div
                      onClick={() => toggleMotorExpand(mg.id)}
                      className="px-3.5 py-3 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div className="flex items-center justify-center">
                          {expanded ? (
                            <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
                          )}
                        </div>
                        
                        {/* Motor Icon with glowing backdrop if active */}
                        <div 
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-300 ${
                            isMotorActive
                              ? motionType === "motor"
                                ? "bg-purple-500/15 text-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.15)] animate-pulse"
                                : motionType === "xyz_rotation"
                                  ? "bg-cyan-500/15 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.15)] animate-pulse"
                                  : "bg-amber-500/15 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.15)] animate-pulse"
                              : "bg-slate-800/60 text-slate-400 border border-white/5"
                          }`}
                        >
                          {icon}
                        </div>

                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-slate-200 truncate">
                            {mg.name || `Motor #${mg.id}`}
                          </span>
                          <span className="text-[9px] text-slate-500 font-semibold tracking-wide uppercase mt-0.5">
                            {typeLabel} â€¢ {mg.shapeIds.length} {mg.shapeIds.length === 1 ? "part" : "parts"}
                          </span>
                        </div>
                      </div>

                      {/* Header Actions */}
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {/* Quick Active Dot */}
                        <div 
                          className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                            isMotorActive 
                              ? motionType === "motor"
                                ? "bg-purple-400 shadow-[0_0_8px_#c084fc]"
                                : motionType === "xyz_rotation"
                                  ? "bg-cyan-400 shadow-[0_0_8px_#67e8f9]"
                                  : "bg-amber-400 shadow-[0_0_8px_#fcd34d]"
                              : "bg-slate-700"
                          }`}
                          title={isMotorActive ? "Motor Running" : "Motor Idle"}
                        />

                        {isMotorActive && (
                          <button
                            onClick={() => stopMotor(mg.id)}
                            className="w-5 h-5 flex items-center justify-center rounded border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer transition-all duration-200"
                            title="Stop Motor"
                          >
                            <Square size={8} fill="currentColor" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Collapsible Content */}
                    {expanded && (
                      <div className="px-3.5 pb-3.5 pt-1 border-t border-white/[0.03] flex flex-col gap-3">
                        {memberNames && (
                          <div className="text-[9px] text-slate-400 bg-black/10 border border-white/[0.03] px-2 py-1.5 rounded truncate" title={memberNames}>
                            <span className="font-semibold text-slate-500">Connected:</span> {memberNames}
                          </div>
                        )}

                        {/* Motor type: single axis speed slider */}
                        {motionType === "motor" && (
                          <div className="flex flex-col gap-2.5">
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[9px]">
                                Rotation ({mg.jointAxis?.toUpperCase() || "Y"} axis)
                              </span>
                              <span className={speed[0] !== 0 ? "text-purple-300 font-mono font-bold text-xs" : "font-mono text-[11px]"}>
                                {speed[0] > 0 ? `+${speed[0].toFixed(1)}` : speed[0].toFixed(1)} rad/s
                              </span>
                            </div>
                            
                            <div className="relative flex items-center">
                              {/* Central Zero Mark */}
                              <div className="absolute left-1/2 w-0.5 h-3 bg-white/20 -translate-x-1/2 pointer-events-none" title="Zero" />
                              <input
                                type="range" min="-30" max="30" step="0.5"
                                value={speed[0]}
                                onChange={(e) => setMotorSpeed(mg.id, 0, Number(e.target.value))}
                                className="w-full h-1.5 bg-black/30 rounded-lg appearance-none cursor-pointer accent-purple-500 border border-white/5"
                              />
                            </div>
                            
                            {/* Segmented Preset Buttons */}
                            <div className="flex gap-1 bg-black/30 p-0.5 rounded-lg border border-white/5">
                              {[-15, -5].map((preset) => (
                                <button
                                  key={preset}
                                  onClick={() => setMotorSpeed(mg.id, 0, preset)}
                                  className={`flex-1 text-[9px] font-bold py-1.5 rounded cursor-pointer transition-all duration-150 ${
                                    speed[0] === preset
                                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.15)]"
                                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"
                                  }`}
                                >
                                  {preset}
                                </button>
                              ))}
                              <button
                                onClick={() => setMotorSpeed(mg.id, 0, 0)}
                                className={`flex-1 text-[9px] font-bold py-1.5 rounded cursor-pointer transition-all duration-150 ${
                                  speed[0] === 0
                                    ? "bg-red-500/20 text-red-300 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]"
                                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"
                                  }`}
                              >
                                Stop
                              </button>
                              {[5, 15].map((preset) => (
                                <button
                                  key={preset}
                                  onClick={() => setMotorSpeed(mg.id, 0, preset)}
                                  className={`flex-1 text-[9px] font-bold py-1.5 rounded cursor-pointer transition-all duration-150 ${
                                    speed[0] === preset
                                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.15)]"
                                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"
                                  }`}
                                >
                                  +{preset}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* XYZ Rotation & Linear: fader deck console */}
                        {(motionType === "xyz_rotation" || motionType === "linear") && (
                          <div className="flex justify-between items-stretch gap-2 bg-black/35 border border-white/5 p-3 rounded-xl">
                            {(["X", "Y", "Z"] as const).map((label, idx) => {
                              const axColor = idx === 0 ? "accent-red-500" : idx === 1 ? "accent-emerald-500" : "accent-blue-500";
                              const textCol = idx === 0 ? "text-red-400" : idx === 1 ? "text-emerald-400" : "text-blue-400";
                              const badgeBg = idx === 0 ? "bg-red-500/10 border-red-500/25" : idx === 1 ? "bg-emerald-500/10 border-emerald-500/25" : "bg-blue-500/10 border-blue-500/25";
                              const rangeMin = motionType === "xyz_rotation" ? -20 : -10;
                              const rangeMax = motionType === "xyz_rotation" ? 20 : 10;
                              const rangeStep = motionType === "xyz_rotation" ? 0.5 : 0.1;

                              return (
                                <div key={label} className="flex-1 flex flex-col items-center gap-2 bg-white/[0.01] border border-white/[0.03] p-2 rounded-lg">
                                  {/* Axis Badge */}
                                  <span className={`text-[8px] font-bold w-5 h-4.5 rounded flex items-center justify-center border ${badgeBg} ${textCol}`}>
                                    {label}
                                  </span>

                                  {/* Vertical Slider Wrapper */}
                                  <div className="relative h-20 flex items-center justify-center py-1">
                                    {/* Central Zero tick behind slider */}
                                    <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/10 pointer-events-none" />
                                    <input
                                      type="range"
                                      min={rangeMin}
                                      max={rangeMax}
                                      step={rangeStep}
                                      value={speed[idx]}
                                      onChange={(e) => setMotorSpeed(mg.id, idx, Number(e.target.value))}
                                      style={{
                                        writingMode: "vertical-lr",
                                        WebkitAppearance: "slider-vertical",
                                        height: "64px",
                                        width: "12px",
                                        padding: "0",
                                        margin: "0"
                                      }}
                                      className={`cursor-pointer ${axColor}`}
                                    />
                                  </div>

                                  {/* Value display */}
                                  <div className="text-[9px] font-semibold font-mono tracking-tighter text-slate-300">
                                    {speed[idx] > 0 ? `+${speed[idx].toFixed(1)}` : speed[idx].toFixed(1)}
                                  </div>

                                  {/* Axis stop button */}
                                  <button
                                    onClick={() => setMotorSpeed(mg.id, idx, 0)}
                                    className={`w-4.5 h-4.5 flex items-center justify-center rounded border transition-colors cursor-pointer ${
                                      speed[idx] !== 0
                                        ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                        : "border-white/5 bg-white/5 hover:bg-white/10 text-slate-500 hover:text-slate-300"
                                    }`}
                                    title={`Stop ${label} axis`}
                                  >
                                    <Square size={5} fill="currentColor" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Assembly Status Info */}
        <div className="p-4.5 border-t border-white/5 bg-slate-950/40 flex-shrink-0">
          <div className="flex items-start gap-2.5">
            <Shield size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-slate-300">Vehicle Assembly Status</div>
              <div className="text-[10px] text-slate-500 leading-normal mt-1">
                {driveMotorsCount > 0 || steerMotorsCount > 0 ? (
                  <>
                    Detected <span className="text-emerald-400 font-bold">{driveMotorsCount} drive motor(s)</span> and{" "}
                    <span className="text-emerald-400 font-bold">{steerMotorsCount} steering motor(s)</span>. Driving controls are actively mapped!
                  </>
                ) : (
                  <>
                    No drive/steer motor groups configured in CAD Studio. Connect wheels to chassis via motor groups with designated roles to enable driving.
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* â”€â”€ WEBGL PHYSICS CANVAS VIEWPORT â”€â”€ */}
      <div className="flex-1 h-full relative">
        {shapes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d16] text-slate-400 select-none">
            <h3 className="text-base font-bold text-slate-200 mb-1">No Model Loaded</h3>
            <p className="text-xs text-slate-500">Go back to the CAD Editor and build something first!</p>
          </div>
        ) : (
          <Canvas
            key={simulationKey}
            shadows={{ type: THREE.PCFSoftShadowMap }}
            dpr={Math.min(window.devicePixelRatio, 2)}
            flat
            gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          >
            {/* Suspense covers *pending* loads only — a 404 or malformed .glb
            rejects, and that throw used to unwind past it and blank the whole
            page. Fallback is `null` because this boundary is inside <Canvas>;
            the DOM-side notice is rendered below, driven by onError. */}
            <ErrorBoundary
              label="simulation scene"
              fallback={null}
              onError={(err) => setSceneError(err.message || String(err))}
            >
              <React.Suspense fallback={null}>
                <SimulationScene
                  shapes={shapes}
                  groups={groups}
                  motorGroups={motorGroups}
                  paths={paths}
                  isPlaying={isPlaying}
                  debugOutlines={debugOutlines}
                  gravity={gravity}
                  wsSettings={wsSettings}
                  customMotorSpeeds={customMotorSpeeds}
                  circuitFrame={liveSimulationFrame}
                />
              </React.Suspense>
            </ErrorBoundary>
          </Canvas>
        )}

        {sceneError && (
          <div
            role="alert"
            className="absolute top-5 left-1/2 -translate-x-1/2 z-20 max-w-[520px] px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-300 text-[11px] shadow-lg backdrop-blur-sm"
          >
            <span className="font-bold uppercase tracking-wider">Scene error</span>
            <span className="mx-2 opacity-40">|</span>
            <span className="opacity-90">
              An asset failed to load, so the simulation is not rendering. See
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

        {/* Visual feedback notice when paused */}
        {!isPlaying && (
          <div className="absolute top-5 right-5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/35 text-amber-400 text-[10px] font-bold rounded-lg uppercase tracking-wider shadow-lg select-none backdrop-blur-sm animate-pulse">
            SIMULATION PAUSED
          </div>
        )}
        {cadStreamConnected && liveSimulationFrame?.running && (
          <div className="absolute top-5 right-5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/35 text-emerald-300 text-[10px] font-bold rounded-lg uppercase tracking-wider shadow-lg select-none backdrop-blur-sm">
            CIRCUIT LINKED - RPM {circuitMotionStats.rpm} - {circuitMotionStats.kmh.toFixed(1)} km/h
          </div>
        )}
        {paths.length > 0 && (
          <div className="absolute bottom-5 left-5 px-3 py-1.5 bg-slate-800/80 border border-slate-600/50 text-slate-300 text-[10px] font-semibold rounded-lg shadow-lg select-none backdrop-blur-sm">
            Motion paths are not simulated in physics — only motors/joints drive movement here.
          </div>
        )}
      </div>

    </div>
  );
}


