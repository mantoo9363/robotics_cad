import React, { useState, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import type { ShapeType } from "../../App";

type UnifiedScaleGizmoProps = {
  selectedIds: number[];
  shapes: ShapeType[];
  meshRefs: React.MutableRefObject<Map<number, THREE.Object3D>>;
  startScaleDrag: (
    e: any,
    shape: ShapeType,
    direction: string,
  ) => void;
};

export default function UnifiedScaleGizmo({
  selectedIds,
  shapes,
  meshRefs,
  startScaleDrag,
}: UnifiedScaleGizmoProps) {
  const gizmoGroupRef = useRef<THREE.Group>(null);
  const wireframeRef = useRef<THREE.Mesh>(null);
  const handleRefs = useRef<Map<number, THREE.Mesh>>(new Map());

  useFrame(() => {
    if (!gizmoGroupRef.current || !wireframeRef.current) return;

    // Compute combined bounding box of all selected shapes
    const combinedBox = new THREE.Box3();
    selectedIds.forEach((id) => {
      const obj = meshRefs.current.get(id);
      if (obj) {
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        combinedBox.union(box);
      }
    });

    if (combinedBox.isEmpty()) return;

    // Update gizmo group position to bounding box center
    const center = new THREE.Vector3();
    combinedBox.getCenter(center);
    gizmoGroupRef.current.position.copy(center);

    // Update gizmo group scale to bounding box size
    const size = new THREE.Vector3();
    combinedBox.getSize(size);
    wireframeRef.current.scale.copy(size);

    // Update handle positions and scales
    const handles = [
      // Corners
      { dir: "+x+z", pos: [0.5, -0.5, 0.5] as [number, number, number], color: "#38bdf8" },
      { dir: "-x+z", pos: [-0.5, -0.5, 0.5] as [number, number, number], color: "#38bdf8" },
      { dir: "+x-z", pos: [0.5, -0.5, -0.5] as [number, number, number], color: "#38bdf8" },
      { dir: "-x-z", pos: [-0.5, -0.5, -0.5] as [number, number, number], color: "#38bdf8" },
      // Edges
      { dir: "+x", pos: [0.5, 0, 0] as [number, number, number], color: "#0f172a" },
      { dir: "-x", pos: [-0.5, 0, 0] as [number, number, number], color: "#0f172a" },
      { dir: "+y", pos: [0, 0.5, 0] as [number, number, number], color: "#38bdf8" },
      { dir: "-y", pos: [0, -0.5, 0] as [number, number, number], color: "#38bdf8" },
      { dir: "+z", pos: [0, 0, 0.5] as [number, number, number], color: "#0f172a" },
      { dir: "-z", pos: [0, 0, -0.5] as [number, number, number], color: "#0f172a" },
    ];

    handles.forEach((h, idx) => {
      const handle = handleRefs.current.get(idx);
      if (handle) {
        handle.position.set(
          h.pos[0] * size.x,
          h.pos[1] * size.y,
          h.pos[2] * size.z,
        );
      }
    });
  });

  const handles = [
    // Corners
    { dir: "+x+z", pos: [0.5, -0.5, 0.5] as [number, number, number], color: "#38bdf8" },
    { dir: "-x+z", pos: [-0.5, -0.5, 0.5] as [number, number, number], color: "#38bdf8" },
    { dir: "+x-z", pos: [0.5, -0.5, -0.5] as [number, number, number], color: "#38bdf8" },
    { dir: "-x-z", pos: [-0.5, -0.5, -0.5] as [number, number, number], color: "#38bdf8" },
    // Edges
    { dir: "+x", pos: [0.5, 0, 0] as [number, number, number], color: "#0f172a" },
    { dir: "-x", pos: [-0.5, 0, 0] as [number, number, number], color: "#0f172a" },
    { dir: "+y", pos: [0, 0.5, 0] as [number, number, number], color: "#38bdf8" },
    { dir: "-y", pos: [0, -0.5, 0] as [number, number, number], color: "#38bdf8" },
    { dir: "+z", pos: [0, 0, 0.5] as [number, number, number], color: "#0f172a" },
    { dir: "-z", pos: [0, 0, -0.5] as [number, number, number], color: "#0f172a" },
  ];

  // Get the first selected shape for the startScaleDrag callback
  const firstSelectedShape = shapes.find((s) => selectedIds.includes(s.id));

  return (
    <group ref={gizmoGroupRef}>
      {/* Wireframe bounding box */}
      <mesh ref={wireframeRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial visible={false} />
        <Edges color="#4361ee" scale={1.01} />
      </mesh>

      {firstSelectedShape &&
        handles.map((h, idx) => (
          <UnifiedScaleHandle
            key={idx}
            dir={h.dir}
            pos={h.pos}
            color={h.color}
            shape={firstSelectedShape}
            handleRef={(el) => {
              if (el) handleRefs.current.set(idx, el);
            }}
            startScaleDrag={startScaleDrag}
          />
        ))}
    </group>
  );
}

function UnifiedScaleHandle({
  dir,
  pos,
  color,
  shape,
  handleRef,
  startScaleDrag,
}: {
  dir: string;
  pos: [number, number, number];
  color: string;
  shape: ShapeType;
  handleRef: (el: THREE.Mesh | null) => void;
  startScaleDrag: (
    e: any,
    shape: ShapeType,
    direction: string,
  ) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const boxRef = useRef<THREE.Mesh>(null);
  const hoverScaleRef = useRef(1.0);

  // Forward ref to parent
  useEffect(() => {
    handleRef(boxRef.current);
  }, [boxRef, handleRef]);

  const handleBoxSize = 0.35;

  useFrame((state) => {
    if (!boxRef.current) return;

    // Dynamic size based on camera distance
    const camPos = new THREE.Vector3();
    state.camera.getWorldPosition(camPos);
    const handleWorldPos = new THREE.Vector3();
    boxRef.current.getWorldPosition(handleWorldPos);
    const dist = camPos.distanceTo(handleWorldPos);

    const targetScale = hovered ? 1.4 : 1.0;
    hoverScaleRef.current = THREE.MathUtils.lerp(hoverScaleRef.current, targetScale, 0.25);
    
    // Scale size proportionally to distance
    const dynamicScaleFactor = dist * 0.007; // 0.35 at distance 50
    const size = dynamicScaleFactor * hoverScaleRef.current;

    boxRef.current.scale.setScalar(size / handleBoxSize);
  });

  return (
    <group position={pos}>
      <mesh
        ref={boxRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          startScaleDrag(e, shape, dir);
        }}
      >
        <boxGeometry args={[handleBoxSize, handleBoxSize, handleBoxSize]} />
        <meshBasicMaterial
          color={hovered ? "#fbbf24" : color}
          depthTest={false}
          transparent
          opacity={0.9}
        />
        <Edges color={hovered ? "#d97706" : (color === "#0f172a" ? "#cbd5e1" : "#1e293b")} />
        {/* Invisible over-sized hit target — see ScaleGizmo.tsx. */}
        <mesh scale={2.8}>
          <boxGeometry args={[handleBoxSize, handleBoxSize, handleBoxSize]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </mesh>
    </group>
  );
}
