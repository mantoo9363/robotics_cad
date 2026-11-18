export type WorkspaceSettings = {
  darkBackground: boolean;
  showShadows: boolean;
  showGrid: boolean;
  showJointLabels: boolean;
  zoomSpeed: number; // 5–100
  units: "mm" | "cm";
  scale: string;
  scalePreset: string;
  presetWidth: number;
  presetLength: number;
};

export const PRINTER_PRESETS: { name: string; width: number; length: number }[] = [
  { name: "Ultimaker 2+", width: 223, length: 223 },
  { name: "Prusa i3 MK3", width: 250, length: 210 },
  { name: "Ender 3", width: 220, length: 220 },
  { name: "Bambu X1", width: 256, length: 256 },
  { name: "Makerbot Replicator", width: 252, length: 199 },
];

export const DEFAULT_WS_SETTINGS: WorkspaceSettings = {
  darkBackground: false,
  showShadows: true,
  showGrid: true,
  showJointLabels: true,
  zoomSpeed: 55,
  units: "mm",
  scale: "1:1",
  scalePreset: "Ultimaker 2+",
  presetWidth: 223,
  presetLength: 223,
};

export function loadWsSettings(): WorkspaceSettings {
  try {
    const raw = localStorage.getItem("cad-ws-settings");
    if (raw) return { ...DEFAULT_WS_SETTINGS, ...JSON.parse(raw) };
  } catch (err) {
    console.warn(
      '[workspace] localStorage["cad-ws-settings"] is not valid JSON — ' +
        "falling back to defaults. Clear that key to silence this.",
      err,
    );
  }
  return { ...DEFAULT_WS_SETTINGS };
}

export function saveWsSettings(s: WorkspaceSettings) {
  localStorage.setItem("cad-ws-settings", JSON.stringify(s));
}
