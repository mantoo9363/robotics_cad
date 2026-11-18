import React, { useState, useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

type PlacementPreviewProps = {
  placementShape: string | null;
  setPlacementShape: React.Dispatch<React.SetStateAction<string | null>>;
  finalizePlacement: (type: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
};

export default function PlacementPreview({
  placementShape,
  setPlacementShape,
  finalizePlacement,
}: PlacementPreviewProps) {
  const { raycaster, mouse, scene, camera, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const [pos, setPos] = useState<[number, number, number]>([0, 1.5, 0]);
  const [rot, setRot] = useState<[number, number, number]>([0, 0, 0]);

  useFrame(() => {
    if (!placementShape) return;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    // Ignore the preview mesh, grid helpers, and other non-solid objects
    const valid = intersects.find((i) => {
      let obj: THREE.Object3D | null = i.object;
      while (obj) {
        if (obj.userData?.isPlacementPreview || obj.userData?.isHelper) return false;
        obj = obj.parent;
      }
      return true;
    });

    if (valid && valid.normal) {
      setPos([valid.point.x, valid.point.y + 1.5, valid.point.z]);
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, valid.normal);
      const euler = new THREE.Euler().setFromQuaternion(quat);
      setRot([euler.x, euler.y, euler.z]);
    } else {
      // Default to origin raycast on floor
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        setPos([target.x, target.y + 1.5, target.z]);
        setRot([0, 0, 0]);
      }
    }
  });

  useEffect(() => {
    if (!placementShape) return;
    const onClick = (e: MouseEvent) => {
      if (e.target !== gl.domElement) return;
      finalizePlacement(placementShape, pos, rot);
      setPlacementShape(null);
    };
    window.addEventListener("pointerdown", onClick);
    return () => window.removeEventListener("pointerdown", onClick);
  }, [placementShape, pos, rot, finalizePlacement, setPlacementShape, gl]);

  if (!placementShape) return null;

  return (
    <group position={pos} rotation={rot} ref={groupRef} userData={{ isPlacementPreview: true }}>
      <mesh>
        <boxGeometry args={[3, 3, 3]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.5} depthTest={false} />
      </mesh>
    </group>
  );
}
