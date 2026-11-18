import React, { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShapeType } from "../../App";

type RotationLabelsProps = {
  shape: ShapeType;
  meshRef: React.MutableRefObject<THREE.Object3D | null>;
};

const WORLD_POS = new THREE.Vector3();

export default function RotationLabels({ shape, meshRef }: RotationLabelsProps) {
  const dims = shape.scale.map((s, i) => s * (shape.baseSize?.[i] ?? 1));
  const maxDim = Math.max(...dims, 1);
  const labelY = maxDim / 2 + 1.2;
  const labelRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const { camera } = useThree();

  const jointAxis = shape.jointAxis || "xyz";
  const showAxis = (axis: string) => jointAxis === "xyz" || jointAxis === axis;

  useFrame(() => {
    const obj = meshRef.current;
    if (!obj || !labelRef.current) return;

    let rx = 0;
    let ry = 0;
    let rz = 0;

    if (obj.userData.activeDragRotation) {
      const d = obj.userData.activeDragRotation;
      rx = d.x;
      ry = d.y;
      rz = d.z;
    } else {
      const jointGroup: THREE.Object3D | undefined = obj.userData.jointGroup;
      if (jointGroup && (jointGroup.rotation.x !== 0 || jointGroup.rotation.y !== 0 || jointGroup.rotation.z !== 0)) {
        const q = new THREE.Quaternion().multiplyQuaternions(
          obj.quaternion,
          jointGroup.quaternion,
        );
        const euler = new THREE.Euler().setFromQuaternion(q);
        rx = THREE.MathUtils.radToDeg(euler.x);
        ry = THREE.MathUtils.radToDeg(euler.y);
        rz = THREE.MathUtils.radToDeg(euler.z);
      } else {
        rx = THREE.MathUtils.radToDeg(obj.rotation.x);
        ry = THREE.MathUtils.radToDeg(obj.rotation.y);
        rz = THREE.MathUtils.radToDeg(obj.rotation.z);
      }
    }

    const parts: string[] = [];
    if (showAxis("x")) parts.push(`X${rx.toFixed(0)}\u00B0`);
    if (showAxis("y")) parts.push(`Y${ry.toFixed(0)}\u00B0`);
    if (showAxis("z")) parts.push(`Z${rz.toFixed(0)}\u00B0`);

    labelRef.current.textContent = parts.join(" ");

    obj.getWorldPosition(WORLD_POS);
    const dist = camera.position.distanceTo(WORLD_POS);
    const refDist = 50;
    scaleRef.current = THREE.MathUtils.lerp(scaleRef.current, refDist / Math.max(dist, 1), 0.1);
    labelRef.current.style.transform = `scale(${scaleRef.current.toFixed(3)})`;
  });

  return (
    <Html position={[0, labelY, 0]} center zIndexRange={[1, 0]}>
      <div
        ref={labelRef}
        style={{
          background: "rgba(0,0,0,0.7)",
          border: "1.5px solid #fbbf24",
          borderRadius: "6px",
          color: "#fbbf24",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "13px",
          fontWeight: 700,
          padding: "3px 10px",
          whiteSpace: "nowrap",
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
          pointerEvents: "none",
          userSelect: "none",
          transformOrigin: "center center",
        }}
      >
        X0° Y0° Z0°
      </div>
    </Html>
  );
}
