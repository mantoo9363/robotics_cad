import React from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";
import type { WorkspaceSettings } from "../../types/workspace";

type WorkplaneSurfaceProps = {
  wsSettings?: WorkspaceSettings;
};

export default function WorkplaneSurface({ wsSettings }: WorkplaneSurfaceProps) {
  const width = wsSettings?.presetWidth || 223;
  const length = wsSettings?.presetLength || 223;
  const halfW = width / 2;
  const halfL = length / 2;
  const labelSize = Math.max(1.2, width * 0.055);
  const unitSize = Math.max(0.45, width * 0.018);
  const inset = Math.max(1.2, width * 0.035);
  const borderY = 0.012;
  const labelY = 0.018;
  const borderPoints = [
    new THREE.Vector3(-halfW, borderY, -halfL),
    new THREE.Vector3(halfW, borderY, -halfL),
    new THREE.Vector3(halfW, borderY, halfL),
    new THREE.Vector3(-halfW, borderY, halfL),
    new THREE.Vector3(-halfW, borderY, -halfL),
  ];

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
        <planeGeometry args={[width, length]} />
        <meshBasicMaterial
          color="#e9fbff"
          transparent
          opacity={0.15}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Line points={borderPoints} color="#80d7ef" lineWidth={3} transparent opacity={0.9} />
      <Text
        position={[-halfW + inset, labelY, halfL - inset]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={labelSize}
        color="#91d7eb"
        anchorX="left"
        anchorY="bottom"
        fillOpacity={0.82}
      >
        Workplane
      </Text>
      <Text
        position={[halfW - inset, labelY, halfL - inset]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={unitSize}
        color="#91d7eb"
        anchorX="right"
        anchorY="bottom"
        fillOpacity={0.82}
      >
        {wsSettings?.scale === "1:1"
          ? "Millimeters"
          : wsSettings?.scale === "1:10"
          ? "Centimeters"
          : wsSettings?.scale === "1:100"
          ? "Meters"
          : wsSettings?.scale === "1:1000"
          ? "Meters"
          : "Millimeters"}
      </Text>
    </group>
  );
}
