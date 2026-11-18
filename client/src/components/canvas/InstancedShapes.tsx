import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ShapeType } from "../../App";
import { getCachedGeometry } from "../../lib/geometryCache";
import { getShapeMaterialProps } from "../../lib/materialUtils";
import { registerDisposer } from "../../lib/useGPUCleanup";

type InstanceGroup = {
  type: string;
  color: string;
  shapes: ShapeType[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

type InstancedShapesProps = {
  shapes: ShapeType[];
  selectedIds: number[];
  motorGroupShapeIds: Set<number>;
  onPointerDown: (e: any, shape: ShapeType) => void;
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>;
};

const dummy = new THREE.Object3D();

function InstancedGroup({ group, onPointerDown, meshRefs }: {
  group: InstanceGroup;
  onPointerDown: (e: any, shape: ShapeType) => void;
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = group.shapes.length;
  const color = new THREE.Color(group.color);

  useEffect(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    group.shapes.forEach((s, i) => {
      const pos = new THREE.Vector3(...s.position);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation));
      const scale = new THREE.Vector3(...s.scale);
      matrix.compose(pos, quat, scale);
      meshRef.current!.setMatrixAt(i, matrix);
      meshRef.current!.setColorAt(i, color);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
    meshRef.current.computeBoundingSphere();
  }, [group.shapes, color]);

  useEffect(() => {
    group.shapes.forEach((s) => {
      if (meshRef.current) {
        meshRef.current.userData.shapeIds = meshRef.current.userData.shapeIds || {};
        meshRef.current.userData.shapeIds[s.id] = true;
      }
    });
  }, [group.shapes]);

  useFrame(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    group.shapes.forEach((s, i) => {
      const pos = new THREE.Vector3(...s.position);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation));
      const scale = new THREE.Vector3(...s.scale);
      matrix.compose(pos, quat, scale);
      meshRef.current!.setMatrixAt(i, matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[group.geometry, group.material, count]}
      castShadow
      receiveShadow
      onPointerDown={(e) => {
        if (e.instanceId !== undefined && e.instanceId < group.shapes.length) {
          onPointerDown(e, group.shapes[e.instanceId]);
        }
      }}
    />
  );
}

export default function InstancedShapes({
  shapes,
  selectedIds,
  motorGroupShapeIds,
  onPointerDown,
  meshRefs,
}: InstancedShapesProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const eligible = useMemo(() => {
    return shapes.filter((s) => {
      if (motorGroupShapeIds.has(s.id)) return false;
      if (s.parentId) return false;
      if (selectedSet.has(s.id)) return false;
      if (s.isLocked) return false;
      if (s.type === "glb" || s.type === "custom") return false;
      // Instancing shares one material per type|color group across every
      // instance in it — that only works because color is already part of
      // the group key. A texture map is a third per-shape dimension the key
      // doesn't account for: the shared material this component builds
      // below is a plain `new THREE.MeshStandardMaterial(...)`, entirely
      // outside ShapeMaterial.tsx's texture-loading logic. A textured shape
      // rendered here would show no texture at all — and worse, since the
      // currently-selected shape is the only thing excluded from
      // instancing (below), a shape you just applied a texture to appears
      // to work while selected (rendered through the real,
      // texture-aware path) and then silently loses it the moment you
      // deselect and it falls into this shared, textureless batch. Excluded
      // outright, same as glb/custom.
      if (s.texturePath) return false;
      return true;
    });
  }, [shapes, motorGroupShapeIds, selectedSet]);

  const groups = useMemo(() => {
    const map = new Map<string, ShapeType[]>();
    eligible.forEach((s) => {
      const key = `${s.type}|${s.color || "#ffffff"}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    const result: InstanceGroup[] = [];
    map.forEach((groupShapes, key) => {
      const [type] = key.split("|");
      const geom = getCachedGeometry(type, "medium");
      const shape0 = groupShapes[0];
      const matProps = getShapeMaterialProps(shape0, null);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(shape0.color || "#ffffff"),
        roughness: matProps.roughness,
        metalness: matProps.metalness,
      });
      result.push({ type, color: shape0.color || "#ffffff", shapes: groupShapes, geometry: geom, material: mat });
    });
    return result;
  }, [eligible]);

  return (
    <>
      {groups.map((g) => (
        <InstancedGroup
          key={`inst-${g.type}-${g.color}`}
          group={g}
          onPointerDown={onPointerDown}
          meshRefs={meshRefs}
        />
      ))}
    </>
  );
}
