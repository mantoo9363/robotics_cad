import React from "react";
import { Text } from "@react-three/drei";

export function CleanAxisMap() {
  return (
    <group scale={50}>
      {/* X Axis - Red */}
      <group>
        <mesh position={[0.4, 0, 0]}>
          <boxGeometry args={[0.8, 0.045, 0.045]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        <mesh position={[0.8, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.09, 0.22, 8]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        <Text
          position={[1.15, 0.08, 0]}
          fontSize={0.2}
          color="#ef4444"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          X
        </Text>
      </group>

      {/* Y Axis (Three.js Z - Green) */}
      <group>
        <mesh position={[0, 0, 0.4]}>
          <boxGeometry args={[0.045, 0.045, 0.8]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
        <mesh position={[0, 0, 0.8]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.09, 0.22, 8]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
        <Text
          position={[0, 0.08, 1.15]}
          fontSize={0.2}
          color="#22c55e"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          Y
        </Text>
      </group>

      {/* Z Axis (Three.js Y - Blue) */}
      <group>
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[0.045, 0.8, 0.045]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
        <mesh position={[0, 0.8, 0]}>
          <coneGeometry args={[0.09, 0.22, 8]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
        <Text
          position={[0, 1.15, 0.08]}
          fontSize={0.2}
          color="#3b82f6"
          fontWeight="bold"
          anchorX="center"
          anchorY="middle"
        >
          Z
        </Text>
      </group>
    </group>
  );
}
