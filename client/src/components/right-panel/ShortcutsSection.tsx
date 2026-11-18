import React from "react";
import { Keyboard } from "lucide-react";

export function ShortcutsSection() {
  const shortcuts = [
    { keys: ["Shift", "Click"], desc: "Multi-select" },
    { keys: ["Drag"], desc: "Move XZ" },
    { keys: ["Alt", "Drag"], desc: "Move Y" },
    { keys: ["Ctrl", "Z"], desc: "Undo" },
    { keys: ["Ctrl", "Y"], desc: "Redo" },
    { keys: ["Ctrl", "D"], desc: "Duplicate" },
    { keys: ["Ctrl", "G"], desc: "Add" },
    { keys: ["Del"], desc: "Delete" },
    { keys: ["Esc"], desc: "Deselect" },
    { keys: ["↑↓←→"], desc: "Nudge XZ" },
    { keys: ["Alt", "↑↓"], desc: "Nudge Y" },
  ];

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
      <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500 mb-3.5 flex items-center gap-1.5 select-none">
        <Keyboard size={12} />
        <span>Keyboard Shortcuts</span>
      </div>
      <div className="flex flex-col gap-2">
        {shortcuts.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-b-0"
          >
            <span className="text-[11px] text-text-muted font-medium">
              {s.desc}
            </span>
            <div className="flex items-center gap-1">
              {s.keys.map((k, j) => (
                <kbd
                  key={j}
                  className="px-1.5 py-0.5 text-[9px] font-bold font-mono bg-white/5 border border-white/10 text-slate-300 rounded shadow-sm select-none"
                  style={{ fontFamily: "ui-monospace, monospace" }}
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
