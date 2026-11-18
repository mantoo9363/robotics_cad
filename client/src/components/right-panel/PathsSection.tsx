import React, { useState, useEffect } from "react";
import type { MotionPath, TransformMode } from "../../App";

type PathsSectionProps = {
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

export function PathsSection({
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
}: PathsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (mode === "drawPath") setIsOpen(true);
  }, [mode]);

  return (
    <div
      className={`bg-white/[0.02] border border-white/[0.05] rounded-[10px] p-2 transition-colors duration-200 hover:border-white/[0.08] ${isOpen ? "open" : ""}`}
    >
      <div
        className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex justify-between items-center cursor-pointer select-none"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span>Paths</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowPaths(!showPaths);
            }}
            title={showPaths ? "Hide Paths" : "Show Paths"}
            className="bg-transparent border-none cursor-pointer flex items-center p-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            {showPaths ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        </div>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transition: "transform 0.3s",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {isOpen && (
        <div className="flex flex-col gap-1">
          <button
            className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-md font-semibold text-[10px] cursor-pointer transition-all duration-200 bg-transparent border border-white/10 text-slate-300 hover:bg-white/5"
            onClick={() => {
              const nid = Date.now();
              let index = 1;
              while (paths.some((p) => p.name === `Path ${index}`)) {
                index++;
              }
              const nextName = `Path ${index}`;
              setPaths([
                ...paths,
                {
                  id: nid,
                  name: nextName,
                  points: [],
                  closed: false,
                },
              ]);
              setSelectedPathId(nid);
              setMode("drawPath");
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {paths.length === 0 ? "New Path" : "Add Path"}
          </button>

          {paths.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "rgba(255,255,255,0.05)",
                padding: "4px 6px",
                borderRadius: "6px",
                border:
                  selectedPathId === p.id
                    ? "1px solid #4361ee"
                    : "1px solid transparent",
              }}
            >
              <input
                style={{
                  flex: 1,
                  fontSize: "10px",
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  outline: "none",
                  minWidth: 0,
                }}
                value={p.name || `Path ${p.id.toString().slice(-4)}`}
                onChange={(e) =>
                  setPaths(
                    paths.map((p2) =>
                      p2.id === p.id ? { ...p2, name: e.target.value } : p2,
                    ),
                  )
                }
                onClick={() => setSelectedPathId(p.id)}
              />
              <button
                disabled={attachedPathIds.has(p.id)}
                className="w-4 h-4 flex items-center justify-center rounded bg-white/5 text-slate-300 text-[9px] hover:bg-white/10 cursor-pointer border-0 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() =>
                  setPaths(
                    paths.map((p2) =>
                      p2.id === p.id ? { ...p2, closed: !p2.closed } : p2,
                    ),
                  )
                }
                title={
                  attachedPathIds.has(p.id)
                    ? "Detach the object first to edit this path"
                    : "Toggle Loop"
                }
              >
                {p.closed ? "⊚" : "≬"}
              </button>
              <button
                className="w-4 h-4 flex items-center justify-center rounded text-red-400 hover:bg-red-500/15 hover:text-red-300 cursor-pointer border-0 bg-transparent text-[10px]"
                onClick={() => {
                  deletePath(p.id);
                  if (selectedPathId === p.id) setSelectedPathId(null);
                }}
                title="Delete Path"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
