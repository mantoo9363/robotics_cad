import React from "react";
import { Text } from "@react-three/drei";
import type { ShapeType } from "../../App";
import type { WorkspaceSettings } from "../../types/workspace";

type DimensionLabelsProps = {
  shape: ShapeType;
  wsSettings?: WorkspaceSettings;
};

export default function DimensionLabels({ shape, wsSettings }: DimensionLabelsProps) {
  const scale = wsSettings?.scale || "1:1";
  
  // Use the same calculation as InspectorSection for consistency
  const baseSize = shape.baseSize ?? [1, 1, 1];
  const dims = shape.scale.map((s, i) => s * baseSize[i]);
  
  let unitLabel = "mm";
  let unitDivisor = 1;
  if (scale === "1:10") {
    unitLabel = "cm";
    unitDivisor = 10;
  } else if (scale === "1:100") {
    unitLabel = "m";
    unitDivisor = 100;
  } else if (scale === "1:1000") {
    unitLabel = "m";
    unitDivisor = 1000;
  }
  
  const labels = [
    { text: `W: ${(dims[0] / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1)}${unitLabel}`, position: [dims[0] / 2 + 0.5, 0, 0] as [number, number, number] },
    { text: `H: ${(dims[1] / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1)}${unitLabel}`, position: [0, dims[1] / 2 + 0.5, 0] as [number, number, number] },
    { text: `D: ${(dims[2] / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1)}${unitLabel}`, position: [0, 0, dims[2] / 2 + 0.5] as [number, number, number] },
  ];
  
  return (
    <>
      {labels.map((label, i) => (
        <Text
          key={i}
          position={label.position}
          fontSize={0.3}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {label.text}
        </Text>
      ))}
    </>
  );
}
