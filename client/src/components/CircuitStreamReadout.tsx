import type { CSSProperties, ReactNode } from "react";
import type { ShapeType } from "../App";
import type {
  CircuitStreamBoardPin,
  CircuitStreamComponentState,
  CircuitStreamFrame,
  CircuitStreamNode,
  CircuitStreamStartPayload,
} from "../lib/circuitStream";

type Props = {
  primarySelected: ShapeType | null;
  liveSimulationFrame: CircuitStreamFrame | null;
  lastCircuitStartPayload: CircuitStreamStartPayload | null;
  unitMode: "mm" | "cm";
};

function fmt(
  v: string | number | boolean | undefined | null,
  suffix = "",
): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number" && !Number.isFinite(v)) return "—";
  return `${v}${suffix}`;
}

function rowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "4px 12px",
    fontSize: "11px",
    padding: "3px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    alignItems: "baseline",
  };
}

function labelCell(text: string): ReactNode {
  return (
    <span style={{ color: "#94a3b8", wordBreak: "break-word" }}>{text}</span>
  );
}

function valueCell(text: string): ReactNode {
  return (
    <span
      style={{
        color: "#f1f5f9",
        fontFamily: "ui-monospace, monospace",
        textAlign: "right",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function SchematicBlock({ node }: { node: CircuitStreamNode }) {
  const props = node.data?.properties;
  if (!props || Object.keys(props).length === 0) return null;
  return (
    <details open style={{ marginTop: "8px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#cbd5e1",
          marginBottom: "6px",
        }}
      >
        Schematic (design values)
      </summary>
      <div
        style={{
          padding: "8px",
          borderRadius: "6px",
          background: "rgba(0,0,0,0.28)",
          maxHeight: "200px",
          overflowY: "auto",
        }}
      >
        <div style={rowStyle()}>
          {labelCell("Node id")}
          {valueCell(node.id)}
        </div>
        <div style={rowStyle()}>
          {labelCell("Type")}
          {valueCell(String(node.data?.componentType ?? "—"))}
        </div>
        <div style={rowStyle()}>
          {labelCell("Label")}
          {valueCell(String(node.data?.label ?? "—"))}
        </div>
        <div style={rowStyle()}>
          {labelCell("Position (schematic)")}
          {valueCell(
            `${fmt(node.position?.x)}, ${fmt(node.position?.y)} px`,
          )}
        </div>
        {node.data?.rotation !== undefined ? (
          <div style={rowStyle()}>
            {labelCell("Rotation (°)")}
            {valueCell(String(node.data.rotation))}
          </div>
        ) : null}
        {Object.entries(props).map(([key, def]) => {
          const title = def.label ?? key;
          const u = def.unit ? ` ${def.unit}` : "";
          return (
            <div key={key} style={rowStyle()}>
              {labelCell(title)}
              {valueCell(`${fmt(def.value)}${u}`)}
            </div>
          );
        })}
        <details style={{ marginTop: "8px" }}>
          <summary
            style={{
              fontSize: "10px",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            Raw node (JSON)
          </summary>
          <pre
            style={{
              margin: "6px 0 0",
              padding: "6px",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.4)",
              fontSize: "9px",
              color: "#cbd5e1",
              overflow: "auto",
              maxHeight: "120px",
            }}
          >
            {JSON.stringify(node, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}

function LiveBlock({ c }: { c: CircuitStreamComponentState }) {
  return (
    <details open style={{ marginTop: "8px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#a5f3fc",
          marginBottom: "6px",
        }}
      >
        Live simulation (this tick)
      </summary>
      <div
        style={{
          padding: "8px",
          borderRadius: "6px",
          background: "rgba(0,0,0,0.28)",
          maxHeight: "220px",
          overflowY: "auto",
        }}
      >
        <div style={rowStyle()}>
          {labelCell("Powered")}
          {valueCell(fmt(c.isPowered))}
        </div>
        <div style={rowStyle()}>
          {labelCell("Brightness")}
          {valueCell(fmt(c.brightness))}
        </div>
        <div style={rowStyle()}>
          {labelCell("Voltage (sim)")}
          {valueCell(
            typeof c.voltage === "number" ? `${c.voltage.toFixed(2)} V` : "—",
          )}
        </div>
        {c.telemetry && Object.keys(c.telemetry).length > 0 ? (
          <>
            <div
              style={{
                fontSize: "10px",
                color: "#64748b",
                marginTop: "8px",
                marginBottom: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Telemetry
            </div>
            {Object.entries(c.telemetry).map(([k, v]) => (
              <div key={k} style={rowStyle()}>
                {labelCell(k)}
                {valueCell(String(v))}
              </div>
            ))}
          </>
        ) : null}
        {c.pins && Object.keys(c.pins).length > 0 ? (
          <>
            <div
              style={{
                fontSize: "10px",
                color: "#64748b",
                marginTop: "8px",
                marginBottom: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Pins
            </div>
            {Object.entries(c.pins).map(([pinName, p]) => (
              <div key={pinName} style={rowStyle()}>
                {labelCell(pinName)}
                {valueCell(
                  `${fmt(p.voltage, " V")} · norm ${fmt(p.normalizedValue)} · ${p.active ? "active" : "idle"}`,
                )}
              </div>
            ))}
          </>
        ) : null}
        <details style={{ marginTop: "8px" }}>
          <summary
            style={{
              fontSize: "10px",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            Raw component (JSON)
          </summary>
          <pre
            style={{
              margin: "6px 0 0",
              padding: "6px",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.4)",
              fontSize: "9px",
              color: "#cbd5e1",
              overflow: "auto",
              maxHeight: "140px",
            }}
          >
            {JSON.stringify(c, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}

function CadShapeBlock({
  shape,
  unitMode,
}: {
  shape: ShapeType;
  unitMode: "mm" | "cm";
}) {
  const [sx, sy, sz] = shape.scale;
  const toUnit = (s: number) =>
    unitMode === "cm" ? (s / 10).toFixed(2) : s.toFixed(1);
  const u = unitMode === "cm" ? "cm" : "mm";
  return (
    <details style={{ marginTop: "8px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#fde68a",
          marginBottom: "6px",
        }}
      >
        CAD shape size & placement
      </summary>
      <div
        style={{
          padding: "8px",
          borderRadius: "6px",
          background: "rgba(0,0,0,0.28)",
        }}
      >
        <div style={rowStyle()}>
          {labelCell("Scale W × D × H")}
          {valueCell(
            `${toUnit(sx)} × ${toUnit(sz)} × ${toUnit(sy)} ${u}`,
          )}
        </div>
        <div style={rowStyle()}>
          {labelCell("Position X, Y, Z")}
          {valueCell(
            `${shape.position[0].toFixed(2)}, ${shape.position[2].toFixed(2)}, ${shape.position[1].toFixed(2)}`,
          )}
        </div>
        <div style={rowStyle()}>
          {labelCell("Rotation X, Y, Z (rad)")}
          {valueCell(
            `${shape.rotation[0].toFixed(2)}, ${shape.rotation[2].toFixed(2)}, ${shape.rotation[1].toFixed(2)}`,
          )}
        </div>
      </div>
    </details>
  );
}

function SerialBlock({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  const tail = lines.slice(-40);
  return (
    <details style={{ marginTop: "10px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#fcd34d",
        }}
      >
        Serial monitor (last {tail.length} lines)
      </summary>
      <pre
        style={{
          marginTop: "6px",
          maxHeight: "160px",
          overflow: "auto",
          padding: "8px",
          borderRadius: "6px",
          background: "rgba(0,0,0,0.45)",
          fontSize: "10px",
          lineHeight: 1.35,
          color: "#fef3c7",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {tail.join("\n")}
      </pre>
    </details>
  );
}

function BoardPinsBlock({ pins }: { pins: CircuitStreamBoardPin[] }) {
  if (!pins.length) return null;
  return (
    <details style={{ marginTop: "10px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#c4b5fd",
        }}
      >
        Board pins ({pins.length})
      </summary>
      <div
        style={{
          marginTop: "6px",
          maxHeight: "180px",
          overflow: "auto",
          borderRadius: "6px",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "10px",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.35)" }}>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>#</th>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>hdl</th>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>mode</th>
              <th style={{ textAlign: "right", padding: "4px 6px" }}>PWM</th>
              <th style={{ textAlign: "right", padding: "4px 6px" }}>V</th>
              <th style={{ textAlign: "center", padding: "4px 4px" }}>on</th>
            </tr>
          </thead>
          <tbody>
            {pins.map((p, i) => (
              <tr
                key={`${p.handleId}-${i}`}
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  background: p.active ? "rgba(34,197,94,0.08)" : undefined,
                }}
              >
                <td style={{ padding: "3px 6px", color: "#94a3b8" }}>
                  {fmt(p.pin)}
                </td>
                <td style={{ padding: "3px 6px", color: "#e2e8f0" }}>
                  {fmt(p.handleId)}
                </td>
                <td style={{ padding: "3px 6px", color: "#cbd5e1" }}>
                  {fmt(p.mode)}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {fmt(p.value)}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {typeof p.voltage === "number" ? p.voltage.toFixed(2) : "—"}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "center" }}>
                  {p.active ? "●" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AllDevicesBlock({
  components,
}: {
  components: Record<string, CircuitStreamComponentState>;
}) {
  const entries = Object.entries(components).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <details style={{ marginTop: "12px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#86efac",
        }}
      >
        All devices ({entries.length})
      </summary>
      <div
        style={{
          marginTop: "8px",
          maxHeight: "260px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {entries.map(([id, c]) => {
          const tel = c.telemetry ?? {};
          const telStr = Object.entries(tel)
            .slice(0, 4)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ");
          return (
            <div
              key={id}
              style={{
                padding: "8px",
                borderRadius: "6px",
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "10px",
                lineHeight: 1.45,
              }}
            >
              <div style={{ color: "#f8fafc", fontWeight: 600 }}>{id}</div>
              <div style={{ color: "#94a3b8" }}>
                {fmt(c.componentType)} · {fmt(c.label)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                V={typeof c.voltage === "number" ? c.voltage.toFixed(2) : "—"} ·
                powered={fmt(c.isPowered)} · brightness={fmt(c.brightness)}
              </div>
              {telStr ? (
                <div style={{ color: "#a5b4fc", marginTop: "4px" }}>{telStr}</div>
              ) : null}
              <details style={{ marginTop: "6px" }}>
                <summary
                  style={{
                    fontSize: "9px",
                    cursor: "pointer",
                    color: "#64748b",
                  }}
                >
                  Full payload (JSON)
                </summary>
                <pre
                  style={{
                    margin: "6px 0 0",
                    padding: "6px",
                    borderRadius: "4px",
                    background: "rgba(0,0,0,0.4)",
                    fontSize: "9px",
                    color: "#cbd5e1",
                    overflow: "auto",
                    maxHeight: "120px",
                  }}
                >
                  {JSON.stringify(c, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function CircuitStreamReadout({
  primarySelected,
  liveSimulationFrame,
  lastCircuitStartPayload,
  unitMode,
}: Props) {
  const nodeId = primarySelected?.circuitNodeId?.trim() ?? "";
  const startNode =
    nodeId && lastCircuitStartPayload?.nodes
      ? lastCircuitStartPayload.nodes.find((n) => n.id === nodeId)
      : undefined;
  const live =
    nodeId && liveSimulationFrame?.components
      ? liveSimulationFrame.components[nodeId]
      : undefined;

  const hasFrame = Boolean(liveSimulationFrame);
  const hasStart = Boolean(lastCircuitStartPayload?.nodes?.length);

  if (!hasFrame && !hasStart && !nodeId) {
    return null;
  }

  return (
    <div style={{ marginTop: "10px" }}>
      {hasFrame && liveSimulationFrame?.serialOutput?.length ? (
        <SerialBlock lines={liveSimulationFrame.serialOutput} />
      ) : null}
      {hasFrame && liveSimulationFrame?.boardPins?.length ? (
        <BoardPinsBlock pins={liveSimulationFrame.boardPins!} />
      ) : null}

      {primarySelected && nodeId ? (
        <div
          style={{
            marginTop: "10px",
            padding: "10px",
            borderRadius: "8px",
            background: "rgba(15,23,42,0.55)",
            border: "1px solid rgba(56,189,248,0.25)",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#e0f2fe",
              marginBottom: "6px",
            }}
          >
            Linked device · {nodeId}
          </div>
          <CadShapeBlock shape={primarySelected} unitMode={unitMode} />
          {startNode ? <SchematicBlock node={startNode} /> : null}
          {live ? (
            <LiveBlock c={live} />
          ) : hasFrame ? (
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: "8px 0 0" }}>
              No live component entry for this id in the current frame.
            </p>
          ) : null}
        </div>
      ) : null}

      {liveSimulationFrame?.components &&
      Object.keys(liveSimulationFrame.components).length > 0 ? (
        <AllDevicesBlock components={liveSimulationFrame.components} />
      ) : null}
    </div>
  );
}
