import React from "react";
import type { ShapeType, CircuitLinkOption } from "../../App";
import type { CircuitStreamFrame, CircuitStreamStartPayload } from "../../lib/circuitStream";
import { CircuitStreamReadout } from "../CircuitStreamReadout";

type CircuitSectionProps = {
  circuitLinkOptions: CircuitLinkOption[];
  cadStreamConnected: boolean;
  liveSimulationFrame: CircuitStreamFrame | null;
  primarySelected: ShapeType | null;
  setPrimaryCircuitNodeId: (circuitNodeId: string) => void;
  lastCircuitStartPayload: CircuitStreamStartPayload | null;
  unitMode: "mm" | "cm";
  streamHostLabel?: string;
};

export function CircuitSection({
  circuitLinkOptions,
  cadStreamConnected,
  liveSimulationFrame,
  primarySelected,
  setPrimaryCircuitNodeId,
  lastCircuitStartPayload,
  unitMode,
  streamHostLabel = "simulation server",
}: CircuitSectionProps) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
      <div
        className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500 mb-2"
        style={{ fontSize: "11px", opacity: 0.85 }}
      >
        Circuit Studio stream
        {circuitLinkOptions.length > 0 ? (
          <span style={{ opacity: 0.6, fontWeight: 400 }}>
            {" "}
            · {circuitLinkOptions.length} node
            {circuitLinkOptions.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: cadStreamConnected ? "#86efac" : "#fca5a5",
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: cadStreamConnected ? "#22c55e" : "#ef4444",
          }}
        />
        {cadStreamConnected
          ? `SSE connected (${streamHostLabel})`
          : "Waiting for simulation server…"}
      </div>
      {liveSimulationFrame && (
        <div
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: "10px",
            lineHeight: 1.45,
            padding: "8px",
            borderRadius: "6px",
            background: "rgba(0,0,0,0.25)",
            marginBottom: "8px",
            color: "#e2e8f0",
          }}
        >
          <div>
            tick <strong>{liveSimulationFrame.tick ?? "—"}</strong> ·
            board{" "}
            <strong>{liveSimulationFrame.boardType ?? "—"}</strong>
          </div>
          <div>
            running{" "}
            <strong>
              {liveSimulationFrame.running ? "yes" : "no"}
            </strong>
            {liveSimulationFrame.error ? (
              <span style={{ color: "#fca5a5" }}>
                {" "}
                · err {String(liveSimulationFrame.error)}
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: "6px", opacity: 0.85 }}>
            powered nodes:{" "}
            {
              Object.values(
                liveSimulationFrame.components ?? {},
              ).filter((c) => c.isPowered).length
            }
          </div>
        </div>
      )}
      {primarySelected && !primarySelected.isLocked && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <label style={{ fontSize: "10px", opacity: 0.75 }}>
            Link shape → circuit node id
          </label>
          <select
            style={{
              padding: "6px 8px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.35)",
              color: "#f8fafc",
              fontSize: "12px",
            }}
            value={(() => {
              const nid = primarySelected.circuitNodeId?.trim() ?? "";
              if (!nid) return "";
              return circuitLinkOptions.some((o) => o.id === nid)
                ? nid
                : "__manual__";
            })()}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__manual__") return;
              if (v === "") {
                setPrimaryCircuitNodeId("");
                return;
              }
              setPrimaryCircuitNodeId(v);
            }}
          >
            <option value="">No circuit link</option>
            {circuitLinkOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.id} ({opt.componentType || "?"}) {opt.label}
              </option>
            ))}
            <option value="__manual__">Custom id (field below)</option>
          </select>
          <input
            type="text"
            placeholder="e.g. t-led-r"
            value={primarySelected.circuitNodeId ?? ""}
            onChange={(e) => setPrimaryCircuitNodeId(e.target.value)}
            style={{
              padding: "6px 8px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.35)",
              color: "#f8fafc",
              fontSize: "12px",
            }}
          />
        </div>
      )}
      <CircuitStreamReadout
        primarySelected={primarySelected}
        liveSimulationFrame={liveSimulationFrame}
        lastCircuitStartPayload={lastCircuitStartPayload}
        unitMode={unitMode}
      />
      {!primarySelected && (
        <p style={{ fontSize: "11px", opacity: 0.65, margin: 0 }}>
          Select a shape to link it to a circuit node. The node list
          fills from the live simulation (each frame lists all{" "}
          <code style={{ fontSize: "10px" }}>components</code> ids) or
          from the last start if the server still has a run in progress.
        </p>
      )}
    </div>
  );
}
