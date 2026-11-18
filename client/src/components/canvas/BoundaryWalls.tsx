import React from "react";
import * as THREE from "three";
import type { WorkspaceSettings } from "../../types/workspace";

type BoundaryWallsProps = {
  wsSettings?: WorkspaceSettings;
};

export default function BoundaryWalls({ wsSettings }: BoundaryWallsProps) {
  const width = wsSettings?.presetWidth || 223;
  const length = wsSettings?.presetLength || 223;
  const W = width; // wall width along X
  const L = length; // wall length along Z
  const H = 0.045; // wall height (thickness on Y - very small)
  const D = 0.22; // wall thickness
  const edgeY = 0;
  const offsetX = width / 2;
  const offsetZ = length / 2;
  const wallMat = {
    color: "#67c8e6",
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  };
  const edgeMat = {
    color: "#289dbf",
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  };

  return (
    <>
      {/* 4 thick boundary walls on floor (X-Z plane) */}
      <mesh position={[0, H / 2, offsetZ]} rotation={[0, 0, 0]}>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[0, H / 2, -offsetZ]} rotation={[0, 0, 0]}>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[offsetX, H / 2, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[D, H, L]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[-offsetX, H / 2, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[D, H, L]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>

      {/* Top edge glow lines */}
      {[
        {
          pos: [0, edgeY, offsetZ] as [number, number, number],
          rot: [0, 0, 0] as [number, number, number],
          len: W,
        },
        {
          pos: [0, edgeY, -offsetZ] as [number, number, number],
          rot: [0, Math.PI, 0] as [number, number, number],
          len: W,
        },
        {
          pos: [offsetX, edgeY, 0] as [number, number, number],
          rot: [0, -Math.PI / 2, 0] as [number, number, number],
          len: L,
        },
        {
          pos: [-offsetX, edgeY, 0] as [number, number, number],
          rot: [0, Math.PI / 2, 0] as [number, number, number],
          len: L,
        },
      ].map((edge, i) => (
        <mesh key={i} position={edge.pos} rotation={edge.rot}>
          <planeGeometry args={[edge.len, 0.12]} />
          <meshStandardMaterial {...edgeMat} />
        </mesh>
      ))}

      {/* Corner pillars (thick blocks on floor) */}
      {(
        [
          [offsetX, H / 2, offsetZ],
          [-offsetX, H / 2, offsetZ],
          [offsetX, H / 2, -offsetZ],
          [-offsetX, H / 2, -offsetZ],
        ] as [number, number, number][]
      ).map((pos, i) => (
        <mesh key={`c${i}`} position={pos}>
          <boxGeometry args={[0.22, H, 0.22]} />
          <meshStandardMaterial color="#73d4ef" transparent opacity={0.55} />
        </mesh>
      ))}
    </>
  );
}
