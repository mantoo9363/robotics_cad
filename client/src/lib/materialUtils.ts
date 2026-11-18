import * as THREE from "three";
import type { ShapeType } from "../App";
import { getShapeCircuitMaterial } from "./circuitStream";
import type { CircuitStreamFrame } from "./circuitStream";

export const HOLE_OPACITY = 0.4;

export function getShapeMaterialProps(
  shape: ShapeType,
  simulationData?: CircuitStreamFrame | { emissive?: string; emissiveIntensity?: number } | null,
  defaultRoughness = 0.2,
  defaultMetalness = 0.1
) {
  const isFrame = simulationData && ("components" in simulationData || "tick" in simulationData || "running" in simulationData);
  const simMaterial = shape.isHole 
    ? undefined 
    : isFrame 
      ? getShapeCircuitMaterial(shape, simulationData as CircuitStreamFrame) 
      : (simulationData as { emissive?: string; emissiveIntensity?: number });
  if (shape.isHole) {
    return {
      color: "#daadad",
      roughness: 1.0,
      metalness: 0.0,
      emissive: "#000000",
      emissiveIntensity: 0,
      transparent: true,
      opacity: HOLE_OPACITY,
      depthWrite: true,
      vertexColors: false,
      side: THREE.FrontSide,
    };
  }

  let finalColor = shape.color || "#fafafa";
  if (isFrame && shape.circuitNodeId) {
    const frame = simulationData as CircuitStreamFrame;
    if (frame.running) {
      const c = frame.components?.[shape.circuitNodeId.trim()];
      if (c && (c.componentType === "led" || c.componentType === "ledrgb")) {
        const powered = Boolean(c.isPowered);
        const b = typeof c.brightness === "number" ? c.brightness : 0;
        if (!powered || b <= 0.05) {
          finalColor = darkenColor(finalColor, 0.5);
        }
      }
    }
  }

  const isCustom = shape.type === "custom";
  const useVertexColors = isCustom && (finalColor.toLowerCase() === "#ffffff" || finalColor.toLowerCase() === "white");

  return {
    color: useVertexColors ? "#ffffff" : finalColor,
    roughness: defaultRoughness,
    metalness: defaultMetalness,
    emissive: simMaterial?.emissive || "#000000",
    emissiveIntensity: simMaterial?.emissiveIntensity || 0,
    transparent: false,
    opacity: 1.0,
    depthWrite: true,
    vertexColors: useVertexColors,
    side: THREE.FrontSide, // Or DOUBLE SIDE depending on the component, some might override this.
  };
}

function darkenColor(colorStr: string, factor = 0.15): string {
  let hex = colorStr.trim();
  const colorMap: Record<string, string> = {
    red: "#ff0000",
    green: "#00ff00",
    blue: "#0000ff",
    yellow: "#ffff00",
    orange: "#ffa500",
    purple: "#800080",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    white: "#ffffff",
  };
  const mapped = colorMap[hex.toLowerCase()];
  if (mapped) hex = mapped;

  if (hex.startsWith("#")) {
    hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length === 6) {
      const r = Math.round(parseInt(hex.slice(0, 2), 16) * factor);
      const g = Math.round(parseInt(hex.slice(2, 4), 16) * factor);
      const b = Math.round(parseInt(hex.slice(4, 6), 16) * factor);
      
      const rHex = r.toString(16).padStart(2, "0");
      const gHex = g.toString(16).padStart(2, "0");
      const bHex = b.toString(16).padStart(2, "0");
      
      return `#${rHex}${gHex}${bHex}`;
    }
  }
  return colorStr;
}
