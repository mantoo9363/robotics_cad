import React, { useState } from "react";
import type { CustomAsset, MotionPath, TransformMode } from "../App";
import { AddObjectsSection } from "./right-panel/AddObjectsSection";
import { PathsSection } from "./right-panel/PathsSection";
import { Search } from "lucide-react";
import type { DropPayload } from "./canvas/DropPlacement";

type Props = {
  startPlacement: (payload: DropPayload | null) => void;
  customAssets: CustomAsset[];
  addCustomAsset: (name: string, url: string) => void;
  removeCustomAsset: (id: string) => void;
  snapToGrid: boolean;
  setSnapToGrid: (v: boolean) => void;
  snapIncrement: number;
  setSnapIncrement: (v: number) => void;
  openSettingsModal: () => void;
  paths: MotionPath[];
  setPaths: (paths: MotionPath[]) => void;
  deletePath: (pathId: number) => void;
  attachedPathIds: Set<number>;
  selectedPathId: number | null;
  setSelectedPathId: (id: number | null) => void;
  showPaths: boolean;
  setShowPaths: (show: boolean) => void;
  mode: TransformMode;
  setMode: (mode: TransformMode) => void;
  drawingAltitude: number;
  setDrawingAltitude: (altitude: number) => void;
  activePathWP: number | null;
};

export default function RightPanel({
  startPlacement,
  customAssets,
  addCustomAsset,
  removeCustomAsset,
  snapToGrid,
  setSnapToGrid,
  snapIncrement,
  setSnapIncrement,
  openSettingsModal,
  paths,
  setPaths,
  deletePath,
  attachedPathIds,
  selectedPathId,
  setSelectedPathId,
  showPaths,
  setShowPaths,
  mode,
  setMode,
  drawingAltitude,
  setDrawingAltitude,
  activePathWP,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="w-[220px] bg-slate-900 border-l border-slate-800 flex flex-col h-full z-10 shrink-0">
      {/* Search Bar */}
      <div className="p-2 border-b border-slate-800 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700/80 rounded-md py-1 pl-7 pr-2 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500/80 transition-colors"
          />
        </div>
      </div>

      {/* Shapes Grid Scroll Container */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        <AddObjectsSection
          startPlacement={startPlacement}
          customAssets={customAssets}
          addCustomAsset={addCustomAsset}
          removeCustomAsset={removeCustomAsset}
          searchQuery={searchQuery}
        />
        <PathsSection
          paths={paths}
          setPaths={setPaths}
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
      </div>

      {/* Bottom Grid and Snap Selector */}
      <div className="p-2 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2 shrink-0">
        <button
          onClick={openSettingsModal}
          className="px-2 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-white rounded text-[10px] font-semibold text-slate-300 cursor-pointer transition-colors shadow-sm"
        >
          Settings
        </button>
        
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Snap:</span>
          <select
            value={snapToGrid ? (snapIncrement % 1 === 0 ? snapIncrement.toFixed(1) : snapIncrement.toString()) : "off"}
            onChange={(e) => {
              if (e.target.value === "off") {
                setSnapToGrid(false);
              } else {
                setSnapToGrid(true);
                setSnapIncrement(Number(e.target.value));
              }
            }}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-medium rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="off">Off</option>
            <option value="0.1">0.1 mm</option>
            <option value="0.25">0.25 mm</option>
            <option value="0.5">0.5 mm</option>
            <option value="1.0">1.0 mm</option>
            <option value="2.0">2.0 mm</option>
            <option value="5.0">5.0 mm</option>
          </select>
        </div>
      </div>
    </div>
  );
}
