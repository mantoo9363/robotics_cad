import React from "react";
import type { WorkspaceSettings } from "../../types/workspace";
import { PRINTER_PRESETS, saveWsSettings } from "../../types/workspace";

type WorkspaceSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  settings: WorkspaceSettings;
  onChange: (s: WorkspaceSettings) => void;
};

export default function WorkspaceSettingsModal({
  open,
  onClose,
  settings,
  onChange,
}: WorkspaceSettingsModalProps) {
  if (!open) return null;

  const update = (patch: Partial<WorkspaceSettings>) => {
    onChange({ ...settings, ...patch });
  };

  const handlePreset = (name: string) => {
    const p = PRINTER_PRESETS.find((x) => x.name === name);
    if (p) update({ scalePreset: p.name, presetWidth: p.width, presetLength: p.length });
  };

  // ── shared micro-styles ──────────────────────────────────────────────────────
  const font = "'Inter', 'Segoe UI', system-ui, sans-serif";

  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(30,41,59,0.38)",
    backdropFilter: "blur(3px)",
  };

  const modal: React.CSSProperties = {
    background: "#f1f5f9",
    borderRadius: "10px",
    boxShadow: "0 8px 40px rgba(15,23,42,0.22), 0 1.5px 4px rgba(15,23,42,0.10)",
    width: "320px",
    maxHeight: "88vh",
    overflowY: "auto",
    fontFamily: font,
  };

  const header: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 22px 14px",
    background: "#f1f5f9",
    borderBottom: "1px solid rgba(148,163,184,0.35)",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  const body: React.CSSProperties = {
    padding: "0",
  };

  // Row with label on left + control on right
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 22px",
    background: "#fff",
    borderBottom: "1px solid rgba(226,232,240,0.9)",
  };

  // Full-width row (for slider)
  const fullRow: React.CSSProperties = {
    padding: "10px 22px 12px",
    background: "#fff",
    borderBottom: "1px solid rgba(226,232,240,0.9)",
  };

  const sectionHeader: React.CSSProperties = {
    padding: "11px 22px 5px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#6366f1",
    letterSpacing: "0.03em",
    background: "#f1f5f9",
    borderBottom: "1px solid rgba(226,232,240,0.9)",
  };

  const label: React.CSSProperties = {
    fontSize: "13px",
    color: "#334155",
    fontWeight: 400,
    userSelect: "none",
  };

  // Toggle pill (for background color)
  const pill = (on: boolean): React.CSSProperties => ({
    width: "36px",
    height: "20px",
    borderRadius: "10px",
    background: on ? "#6366f1" : "#cbd5e1",
    position: "relative",
    cursor: "pointer",
    transition: "background 0.18s",
    flexShrink: 0,
  });

  const pillThumb = (on: boolean): React.CSSProperties => ({
    position: "absolute",
    top: "2px",
    left: on ? "18px" : "2px",
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
    transition: "left 0.18s",
  });

  // TinkerCAD-style checkbox
  const cbBox = (checked: boolean): React.CSSProperties => ({
    width: "18px",
    height: "18px",
    borderRadius: "3px",
    border: checked ? "none" : "2px solid #94a3b8",
    background: checked ? "#2563eb" : "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.15s",
  });

  const selectEl: React.CSSProperties = {
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\") no-repeat right 10px center",
    border: "1px solid #cbd5e1",
    borderRadius: "5px",
    padding: "5px 28px 5px 10px",
    fontSize: "13px",
    color: "#1e293b",
    cursor: "pointer",
    outline: "none",
    minWidth: "148px",
  };

  const numInput: React.CSSProperties = {
    width: "72px",
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: "5px",
    padding: "4px 8px",
    fontSize: "13px",
    color: "#1e293b",
    outline: "none",
    textAlign: "right",
  };

  const Checkbox = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <div style={cbBox(checked)} onClick={onChange}>
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <polyline points="2,6 5,9 10,3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={header}>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", fontFamily: font }}>
            Workspace settings
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#94a3b8",
              fontSize: "22px",
              lineHeight: 1,
              padding: "0 2px",
              fontFamily: font,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body ── */}
        <div style={body}>

          {/* Background color */}
          <div style={row}>
            <span style={label}>Background color</span>
            <div style={pill(settings.darkBackground)} onClick={() => update({ darkBackground: !settings.darkBackground })}>
              <div style={pillThumb(settings.darkBackground)} />
            </div>
          </div>

          {/* Show shadows */}
          <div style={{ ...row, cursor: "pointer" }} onClick={() => update({ showShadows: !settings.showShadows })}>
            <span style={label}>Show shadows</span>
            <Checkbox checked={settings.showShadows} onChange={() => update({ showShadows: !settings.showShadows })} />
          </div>

          {/* Show grid */}
          <div style={{ ...row, cursor: "pointer" }} onClick={() => update({ showGrid: !settings.showGrid })}>
            <span style={label}>Show grid</span>
            <Checkbox checked={settings.showGrid} onChange={() => update({ showGrid: !settings.showGrid })} />
          </div>

          {/* Show joint rotation labels */}
          <div style={{ ...row, cursor: "pointer" }} onClick={() => update({ showJointLabels: !settings.showJointLabels })}>
            <span style={label}>Show joint rotation labels</span>
            <Checkbox checked={settings.showJointLabels !== false} onChange={() => update({ showJointLabels: !settings.showJointLabels })} />
          </div>

          {/* Zoom speed */}
          <div style={fullRow}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={label}>Zoom speed</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8", minWidth: "28px" }}>Slow</span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={settings.zoomSpeed}
                onChange={(e) => update({ zoomSpeed: Number(e.target.value) })}
                style={{ flex: 1, accentColor: "#6366f1", height: "4px" }}
              />
              <span style={{ fontSize: "11px", color: "#94a3b8", minWidth: "28px", textAlign: "right" }}>Fast</span>
            </div>
          </div>

          {/* ── Units section ── */}
          <div style={sectionHeader}>Units</div>

          <div style={row}>
            <span style={label}>Units</span>
            <select
              style={selectEl}
              value={settings.units}
              onChange={(e) => update({ units: e.target.value as "mm" | "cm" })}
            >
              <option value="mm">Metric</option>
              <option value="cm">Imperial (cm)</option>
            </select>
          </div>

          <div style={row}>
            <span style={label}>Scale</span>
            <select
              style={selectEl}
              value={settings.scale}
              onChange={(e) => update({ scale: e.target.value })}
            >
              <option value="1:1">1:1 (millimeters)</option>
              <option value="1:10">1:10 (centimeters)</option>
              <option value="1:100">1:100 (meters)</option>
              <option value="1:1000">1:1000 (meters)</option>
            </select>
          </div>

          {/* ── Presets section ── */}
          <div style={sectionHeader}>Presets</div>

          <div style={row}>
            <span style={label}>Presets</span>
            <select
              style={selectEl}
              value={settings.scalePreset}
              onChange={(e) => handlePreset(e.target.value)}
            >
              {PRINTER_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Width / Length */}
          <div style={{ background: "#fff", padding: "6px 22px 12px", borderBottom: "1px solid rgba(226,232,240,0.9)" }}>
            <div style={{ display: "flex", gap: "32px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>Width</span>
                <input
                  style={numInput}
                  type="number"
                  value={settings.presetWidth}
                  onChange={(e) => update({ presetWidth: Number(e.target.value) })}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>Length</span>
                <input
                  style={numInput}
                  type="number"
                  value={settings.presetLength}
                  onChange={(e) => update({ presetLength: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div style={{ padding: "12px 22px 16px", display: "flex", flexDirection: "column", gap: "8px", background: "#f1f5f9" }}>
            <button
              onClick={() => saveWsSettings(settings)}
              style={{
                background: "#fff",
                border: "1.5px solid #6366f1",
                borderRadius: "6px",
                padding: "8px 0",
                fontSize: "13px",
                color: "#6366f1",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
                transition: "background 0.15s",
              }}
            >
              Make default
            </button>
            <button
              onClick={onClose}
              style={{
                background: "#fff",
                border: "1.5px solid #cbd5e1",
                borderRadius: "6px",
                padding: "8px 0",
                fontSize: "13px",
                color: "#475569",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Close settings
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
