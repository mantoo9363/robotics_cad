/** Types aligned with circuit-simulation `SimulationFrame` / SSE `simulation-frame` payload. */

export type CircuitStreamPinState = {
  handleId?: string;
  voltage?: number;
  normalizedValue?: number;
  active?: boolean;
};

export type CircuitStreamComponentState = {
  nodeId?: string;
  componentType?: string;
  label?: string;
  isPowered?: boolean;
  brightness?: number;
  voltage?: number;
  telemetry?: Record<string, number | string | boolean>;
  pins?: Record<string, CircuitStreamPinState>;
};

export type CircuitStreamBoardPin = {
  pin?: number;
  handleId?: string;
  mode?: string;
  value?: number;
  normalizedValue?: number;
  voltage?: number;
  active?: boolean;
};

export type CircuitStreamFrame = {
  tick?: number;
  timestamp?: number;
  boardType?: string;
  running?: boolean;
  error?: string | null;
  serialOutput?: string[];
  boardPins?: CircuitStreamBoardPin[];
  components?: Record<string, CircuitStreamComponentState>;
};

export type CircuitStreamNode = {
  id: string;
  position?: { x?: number; y?: number };
  data?: {
    componentType?: string;
    label?: string;
    cadPosition?: unknown;
    rotation?: number;
    /** Editor properties (resistance, LED color, voltage, â€¦) from Circuit Studio. */
    properties?: Record<
      string,
      {
        label?: string;
        value?: string | number | boolean;
        unit?: string;
        type?: string;
      }
    >;
  };
};

export type CircuitStreamEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  data?: { color?: string };
};

export type CircuitStreamStartPayload = {
  nodes?: CircuitStreamNode[];
  edges?: CircuitStreamEdge[];
  boardType?: string;
};

/** Dropdown row: circuit graph node id + display fields. */
export type CircuitLinkOption = {
  id: string;
  label: string;
  componentType: string;
};

export function mergeCircuitLinkOptionsFromFrame(
  prev: CircuitLinkOption[],
  frame: CircuitStreamFrame | null,
): CircuitLinkOption[] {
  if (!frame?.components) return prev;
  const entries = Object.entries(frame.components);
  if (entries.length === 0) return prev;

  const byId = new Map<string, CircuitLinkOption>();
  for (const o of prev) {
    byId.set(o.id, { ...o });
  }
  for (const [id, c] of entries) {
    const prevRow = byId.get(id);
    const label =
      typeof c.label === "string" && c.label.trim() !== ""
        ? c.label
        : (prevRow?.label ?? id);
    const componentType =
      typeof c.componentType === "string"
        ? c.componentType
        : (prevRow?.componentType ?? "");
    byId.set(id, { id, label, componentType });
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/** Minimal shape fields for material derivation (avoids circular import with `App`). */
export type ShapeCircuitMaterialInput = {
  color: string;
  circuitNodeId?: string;
};

export function getShapeCircuitMaterial(
  shape: ShapeCircuitMaterialInput,
  frame: CircuitStreamFrame | null,
): { color?: string; emissive: string; emissiveIntensity: number } {
  if (!frame?.running || !shape.circuitNodeId?.trim()) {
    return { emissive: "#000000", emissiveIntensity: 0 };
  }

  const c = frame.components?.[shape.circuitNodeId.trim()];
  if (!c) {
    return { emissive: "#000000", emissiveIntensity: 0 };
  }

  const brightness = typeof c.brightness === "number" ? c.brightness : 0;
  const powered = Boolean(c.isPowered);
  const type = c.componentType ?? "";

  if (type === "led" || type === "ledrgb") {
    const ledGlow = powered && brightness > 0.05;
    return {
      color: powered ? shape.color : undefined,
      emissive: shape.color,
      emissiveIntensity: ledGlow ? Math.max(0.12, brightness * 2.8) : 0,
    };
  }

  if (type === "resistor") {
    const v = typeof c.voltage === "number" ? c.voltage : 0;
    const t = Math.min(1, v / 5);
    return {
      emissive: "#ea580c",
      emissiveIntensity: t * 0.45,
    };
  }

  if (type === "dcmotor") {
    return {
      emissive: "#38bdf8",
      emissiveIntensity: powered ? 0.2 + brightness * 0.9 : 0,
    };
  }

  return {
    emissive: "#22d3ee",
    emissiveIntensity: powered ? 0.18 + brightness * 0.55 : 0,
  };
}


export function getCircuitFrameMotionStats(frame: CircuitStreamFrame | null): { rpm: number; kmh: number } {
  if (!frame?.running || !frame.components) return { rpm: 0, kmh: 0 };

  const rpm = Object.values(frame.components).reduce((max, component) => {
    // Handle dcmotor components
    if (component.componentType === "dcmotor") {
      const telemetry = component.telemetry ?? {};
      const directRpm = Number(telemetry.rpm ?? 0);
      const forwardThrottle = Number(telemetry.forwardThrottle ?? 0);
      const reverseThrottle = Number(telemetry.reverseThrottle ?? 0);
      const throttle = Math.max(
        Number.isFinite(forwardThrottle) ? Math.abs(forwardThrottle) : 0,
        Number.isFinite(reverseThrottle) ? Math.abs(reverseThrottle) : 0,
        typeof component.brightness === "number" ? Math.abs(component.brightness) : 0,
      );
      const fallbackRpm = throttle > 0 ? throttle * 2400 : 0;
      const componentRpm = Number.isFinite(directRpm) ? Math.abs(directRpm) : fallbackRpm;
      return Math.max(max, componentRpm, fallbackRpm);
    }

    // Handle any component with RPM telemetry
    const telemetry = component.telemetry ?? {};
    const directRpm = Number(telemetry.rpm ?? 0);
    if (Number.isFinite(directRpm) && directRpm !== 0) {
      return Math.max(max, Math.abs(directRpm));
    }

    return max;
  }, 0);

  return {
    rpm: Math.round(rpm),
    kmh: Math.round((rpm / 2400) * 4 * 10) / 10,
  };
}
