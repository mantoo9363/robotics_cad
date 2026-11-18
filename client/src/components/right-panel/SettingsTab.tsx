import React from "react";
import { Move, RotateCw, Maximize2, PenTool, Eraser, Save, FolderOpen, Download, Trash2, Settings } from "lucide-react";
import type { ShapeType, GroupType, MotionPath, TransformMode, MotorGroup } from "../../App";
import { PathsSection } from "./PathsSection";
import { ShortcutsSection } from "./ShortcutsSection";

type SettingsTabProps = {
  mode: TransformMode;
  setMode: (mode: TransformMode) => void;
  snapToGrid: boolean;
  setSnapToGrid: (v: boolean) => void;
  snapIncrement: number;
  setSnapIncrement: (v: number) => void;
  exportProject: () => void;
  paths: MotionPath[];
  setPaths: (paths: MotionPath[]) => void;
  selectedPathId: number | null;
  setSelectedPathId: (id: number | null) => void;
  showPaths: boolean;
  setShowPaths: (show: boolean) => void;
  importProject: (shapes: ShapeType[], paths: MotionPath[], groups?: GroupType[], motorGroups?: MotorGroup[], importedName?: string) => void;
  drawingAltitude: number;
  setDrawingAltitude: (altitude: number) => void;
  activePathWP: number | null;
  brushSize: number;
  setBrushSize: (size: number) => void;
  brushShape: "sphere" | "cube";
  setBrushShape: (shape: "sphere" | "cube") => void;
  clearCanvas: () => void;
  scaleFromSide: boolean;
  setScaleFromSide: (v: boolean) => void;
};

export function SettingsTab({
  mode,
  setMode,
  snapToGrid,
  setSnapToGrid,
  snapIncrement,
  setSnapIncrement,
  exportProject,
  paths,
  setPaths,
  selectedPathId,
  setSelectedPathId,
  showPaths,
  setShowPaths,
  importProject,
  drawingAltitude,
  setDrawingAltitude,
  activePathWP,
  brushSize,
  setBrushSize,
  brushShape,
  setBrushShape,
  clearCanvas,
  scaleFromSide,
  setScaleFromSide,
}: SettingsTabProps) {
  const snapLevels = [0.1, 0.5, 1.0, 2.0];

  const renderModeIcon = (m: TransformMode, active: boolean) => {
    const size = 16;
    const className = `transition-opacity duration-200 ${active ? "opacity-100" : "opacity-50"}`;
    switch (m) {
      case "translate":
        return <Move size={size} className={className} />;
      case "rotate":
        return <RotateCw size={size} className={className} />;
      case "scale":
        return <Maximize2 size={size} className={className} />;
      case "drawPath":
        return <PenTool size={size} className={className} />;
      case "erase":
        return <Eraser size={size} className={className} />;
      default:
        return null;
    }
  };

  const modeLabels: Record<string, string> = {
    translate: "Move",
    rotate: "Rotate",
    scale: "Scale",
    drawPath: "Path",
    erase: "Erase",
  };

  return (
    <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto z-10">
      {/* Transform Mode */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
        <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500 mb-3">Transform Mode</div>
        <div className="grid grid-cols-3 gap-2">
          {(["translate", "rotate", "scale", "drawPath", "erase"] as TransformMode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                className={`flex flex-col items-center gap-2 py-3 px-1 rounded-xl cursor-pointer transition-all duration-250 border ${
                  active
                    ? "border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_16px_rgba(67,97,238,0.1),inset_0_1px_0_rgba(255,255,255,0.05)] text-indigo-300"
                    : "border-white/6 bg-white/3 text-slate-400 hover:border-indigo-500/30 hover:bg-indigo-500/5"
                }`}
                onClick={() => setMode(m)}
              >
                {renderModeIcon(m, active)}
                <span className={`text-[0.62rem] font-bold uppercase tracking-wider transition-colors duration-200 ${active ? "text-indigo-300" : "text-slate-500"}`}>
                  {modeLabels[m]}
                </span>
              </button>
            );
          })}
        </div>
      </div>


      {/* Erase Brush Controls */}
      {mode === "erase" && (
        <div
          className="bg-red-500/[0.04] border border-red-500/[0.1] p-3 rounded-lg my-2 animate-[slideIn_0.3s_ease]"
        >
          <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-red-400 mb-3 flex items-center gap-1.5">
            <Eraser size={14} />
            Erase Brush Options
          </div>
          <div className="flex flex-col gap-2.5 mt-2">
            <div>
              <div className="flex justify-between text-[11px] mb-1 text-slate-400">
                <span>
                  Brush Size ({brushSize.toFixed(1)} mm)
                </span>
                <span className="font-bold text-red-400">{brushSize}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={brushSize}
                onChange={(e) => setBrushSize(parseFloat(e.target.value))}
                className="w-full accent-red-500"
              />
            </div>

            <div>
              <div className="text-[11px] mb-1.5 text-slate-400">
                Brush Shape
              </div>
              <div className="flex gap-1.5">
                <button
                  className={`flex-1 py-1.5 rounded-lg border cursor-pointer text-xs font-semibold transition-all duration-200 flex justify-center items-center gap-1.5 ${
                    brushShape === "sphere"
                      ? "bg-red-500/15 border-red-500 text-red-400"
                      : "bg-white/5 border-white/8 text-slate-400 hover:bg-white/10"
                  }`}
                  onClick={() => setBrushShape("sphere")}
                >
                  <span className="text-sm">●</span> Sphere
                </button>
                <button
                  className={`flex-1 py-1.5 rounded-lg border cursor-pointer text-xs font-semibold transition-all duration-200 flex justify-center items-center gap-1.5 ${
                    brushShape === "cube"
                      ? "bg-red-500/15 border-red-500 text-red-400"
                      : "bg-white/5 border-white/8 text-slate-400 hover:bg-white/10"
                  }`}
                  onClick={() => setBrushShape("cube")}
                >
                  <span className="text-xs">■</span> Cube
                </button>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 leading-normal opacity-85 mt-1">
              💡 Hover over any shape to see the preview red brush. Click to permanently subtract/erase that part!
            </div>
          </div>
        </div>
      )}

      {/* Path Management */}
      <PathsSection
        paths={paths}
        setPaths={setPaths}
        deletePath={(pathId) => setPaths(paths.filter((p) => p.id !== pathId))}
        attachedPathIds={new Set()}
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

      {/* Import / Export */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
        <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500 mb-3">Import / Export</div>
        <div className="flex flex-col gap-2 mb-3" style={{ gap: "10px" }}>
          <button
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-transparent border border-white/10 text-slate-300 hover:bg-white/5"
            onClick={exportProject}
          >
            <Save size={14} />
            Save Project (.json)
          </button>
          <label
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-transparent border border-white/10 text-slate-300 hover:bg-white/5"
            style={{ margin: 0 }}
          >
            <FolderOpen size={14} />
            Load Project
            <input
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const data = JSON.parse(event.target?.result as string);
                    if (data.shapes && Array.isArray(data.paths))
                      importProject(data.shapes, data.paths, data.groups || [], data.motorGroups || [], file.name.replace(/\.json$/i, ""));
                  } catch (err) {
                    console.error("Load failed", err);
                  }
                };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-[#f59e0b] border border-[#f59e0b] text-[#000] hover:bg-[#d97706] mt-1"
            onClick={() => window.dispatchEvent(new Event("trigger-stl-export"))}
          >
            <Download size={14} />
            Export to STL
          </button>
          <button
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 mt-1"
            onClick={() => window.dispatchEvent(new Event("trigger-glb-export"))}
          >
            <Download size={14} />
            Export to GLB
          </button>
        </div>
      </div>

      {/* Snap Settings */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500">
            Snap to Grid
          </span>
          <div
            className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-300 ${
              snapToGrid ? "bg-indigo-600" : "bg-slate-700"
            }`}
            onClick={() => setSnapToGrid(!snapToGrid)}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                snapToGrid ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </div>
        </div>
        {snapToGrid && (
          <div className="grid grid-cols-4 gap-2 mt-3 animate-[slideIn_0.3s_ease]">
            {snapLevels.map((lvl) => (
              <button
                key={lvl}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-200 ${
                  snapIncrement === lvl
                      ? "bg-indigo-600 border border-indigo-600 text-white"
                      : "bg-white/5 border border-white/8 text-slate-300 hover:bg-white/10"
                }`}
                onClick={() => setSnapIncrement(lvl)}
              >
                {lvl}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scale Settings */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5 text-left">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500">
              Scale from Side
            </span>
            <span className="text-[10px] text-slate-400 opacity-80 leading-normal">
              Anchor opposite face when scaling (vector style) instead of scaling from center.
            </span>
          </div>
          <div
            className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-300 flex-shrink-0 ${
              scaleFromSide ? "bg-indigo-600" : "bg-slate-700"
            }`}
            onClick={() => setScaleFromSide(!scaleFromSide)}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                scaleFromSide ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </div>
        </div>
      </div>


      {/* Keyboard Shortcuts */}
      <ShortcutsSection />

      {/* Danger Zone */}
      <div className="bg-white/[0.02] border border-red-500/25 rounded-[14px] p-4 transition-colors duration-200 hover:border-red-500/30">
        <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-red-400 mb-3">Danger Zone</div>
        <button
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs transition-colors bg-red-950/20 border border-red-500/30 text-red-400 hover:bg-red-900/30 hover:text-red-300 hover:border-red-500/50 cursor-pointer"
          onClick={clearCanvas}
        >
          <Trash2 size={14} />
          Clear Entire Canvas
        </button>
      </div>
    </div>
  );
}
