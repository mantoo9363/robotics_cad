import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getCachedGeometry } from "../../lib/geometryCache";

export function useLODGeometry(
  type: string | undefined,
  distances: [number, number, number] = [0, 20, 80],
): React.RefObject<THREE.Mesh | null> {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const geomsRef = useRef<THREE.BufferGeometry[] | null>(null);
  const currentLevelRef = useRef(-1);

  if (!geomsRef.current) {
    geomsRef.current = [
      getCachedGeometry(type, "high"),
      getCachedGeometry(type, "medium"),
      getCachedGeometry(type, "low"),
    ];
  }

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh || !geomsRef.current) return;
    const dist = mesh.position.distanceTo(camera.position);
    let level = 2;
    if (dist < distances[1]) level = 1;
    if (dist < distances[0]) level = 0;
    if (level !== currentLevelRef.current) {
      currentLevelRef.current = level;
      mesh.geometry = geomsRef.current[level];
    }
  });

  return meshRef;
}
