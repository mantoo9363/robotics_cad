import React, { useState, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Edges, Line, Html } from "@react-three/drei";
import type { ShapeType } from "../../App";

export function getRenderableLocalBox(
  root: THREE.Object3D,
  fallbackSize: [number, number, number] = [1, 1, 1],
) {
  const localBox = new THREE.Box3();
  root.updateMatrixWorld(true);
  const invMatrix = root.matrixWorld.clone().invert();

  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isHelperMesh = materials.some((mat: any) => mat?.wireframe || mat?.visible === false);
    if (isHelperMesh || mesh.name.includes("gizmo") || mesh.name.includes("preview")) return;

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;

    const box = mesh.geometry.boundingBox.clone();
    const localMatrix = new THREE.Matrix4().multiplyMatrices(invMatrix, mesh.matrixWorld);
    box.applyMatrix4(localMatrix);
    localBox.union(box);
  });

  if (localBox.isEmpty()) {
    localBox.setFromCenterAndSize(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(fallbackSize[0], fallbackSize[1], fallbackSize[2]),
    );
  }

  return localBox;
}

type ScaleGizmoProps = {
  shape: ShapeType;
  meshRef: React.MutableRefObject<THREE.Group | null>;
  startScaleDrag: (
    e: any,
    shape: ShapeType,
    direction: string,
  ) => void;
  wsSettings?: import("../../types/workspace").WorkspaceSettings;
};

export default function ScaleGizmo({ shape, meshRef, startScaleDrag, wsSettings }: ScaleGizmoProps) {
  const offset = 0.5;
  const gizmoGroupRef = useRef<THREE.Group>(null);
  const wireframeRef = useRef<THREE.Mesh>(null);
  const localBoxRef = useRef(new THREE.Box3());
  const scaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const [activeDimensionDir, setActiveDimensionDir] = useState<string | null>(null);
  const [dimensionState, setDimensionState] = useState({
    min: [-0.5, -0.5, -0.5] as [number, number, number],
    max: [0.5, 0.5, 0.5] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    baseSize: [1, 1, 1] as [number, number, number],
  });
  const lastDimensionSignatureRef = useRef("");
  const dimensionDragActiveRef = useRef(false);

  useEffect(() => {
    const clearActiveDimension = () => {
      dimensionDragActiveRef.current = false;
      setActiveDimensionDir(null);
    };
    window.addEventListener("pointerup", clearActiveDimension);
    window.addEventListener("blur", clearActiveDimension);
    return () => {
      window.removeEventListener("pointerup", clearActiveDimension);
      window.removeEventListener("blur", clearActiveDimension);
    };
  }, []);

  useFrame(() => {
    const obj = meshRef.current;
    if (!obj || !gizmoGroupRef.current) return;
    const scaleObj = obj.userData.scaleGroup || obj;
    const localBox = getRenderableLocalBox(scaleObj, shape.baseSize || [1, 1, 1]);

    localBoxRef.current.copy(localBox);
    gizmoGroupRef.current.scale.copy(scaleObj.scale);
    scaleRef.current.copy(scaleObj.scale);

    const nextSignature = [
      localBox.min.x,
      localBox.min.y,
      localBox.min.z,
      localBox.max.x,
      localBox.max.y,
      localBox.max.z,
      scaleObj.scale.x,
      scaleObj.scale.y,
      scaleObj.scale.z,
      ...(shape.baseSize || [1, 1, 1]),
    ]
      .map((v) => v.toFixed(2))
      .join(",");
    if (nextSignature !== lastDimensionSignatureRef.current) {
      lastDimensionSignatureRef.current = nextSignature;
      const baseSize = new THREE.Vector3();
      localBox.getSize(baseSize);
      setDimensionState({
        min: [localBox.min.x, localBox.min.y, localBox.min.z],
        max: [localBox.max.x, localBox.max.y, localBox.max.z],
        scale: [scaleObj.scale.x, scaleObj.scale.y, scaleObj.scale.z],
        baseSize: [
          baseSize.x || 1,
          baseSize.y || 1,
          baseSize.z || 1,
        ],
      });
    }

    if (wireframeRef.current) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      localBox.getSize(size);
      localBox.getCenter(center);
      wireframeRef.current.scale.copy(size);
      wireframeRef.current.position.copy(center);
    }
  });

  const handles = [
    // Corners
    { dir: "+x+z", pos: [offset, -offset, offset] as [number, number, number], color: "#38bdf8" },
    { dir: "-x+z", pos: [-offset, -offset, offset] as [number, number, number], color: "#38bdf8" },
    { dir: "+x-z", pos: [offset, -offset, -offset] as [number, number, number], color: "#38bdf8" },
    { dir: "-x-z", pos: [-offset, -offset, -offset] as [number, number, number], color: "#38bdf8" },
    // Edges
    { dir: "+x", pos: [offset, 0, 0] as [number, number, number], color: "#0f172a" },
    { dir: "-x", pos: [-offset, 0, 0] as [number, number, number], color: "#0f172a" },
    { dir: "+y", pos: [0, offset, 0] as [number, number, number], color: "#38bdf8" },
    { dir: "-y", pos: [0, -offset, 0] as [number, number, number], color: "#38bdf8" },
    { dir: "+z", pos: [0, 0, offset] as [number, number, number], color: "#0f172a" },
    { dir: "-z", pos: [0, 0, -offset] as [number, number, number], color: "#0f172a" },
  ];

  return (
    <group ref={gizmoGroupRef}>
      {/* Wireframe bounding box */}
      <mesh ref={wireframeRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial visible={false} />
        <Edges color="#4361ee" scale={1.01} />
      </mesh>
      {activeDimensionDir && (
        <ScaleDimensionGuides box={dimensionState} activeDir={activeDimensionDir} wsSettings={wsSettings} />
      )}

      {handles.map((h, idx) => {
        return (
          <SingleScaleHandle
            key={idx}
            dir={h.dir}
            pos={h.pos}
            color={h.color}
            shape={shape}
            meshRef={meshRef}
            localBoxRef={localBoxRef}
            dimensionDragActiveRef={dimensionDragActiveRef}
            setActiveDimensionDir={setActiveDimensionDir}
            startScaleDrag={startScaleDrag}
          />
        );
      })}
    </group>
  );
}

type DimensionBoxState = {
  min: [number, number, number];
  max: [number, number, number];
  scale: [number, number, number];
  baseSize: [number, number, number];
};

function formatDimension(value: number) {
  return value.toFixed(2);
}

function DimensionLabel({
  position,
  children,
}: {
  position: [number, number, number];
  children: React.ReactNode;
}) {
  return (
    <Html position={position} center zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
      <div
        style={{
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(15,23,42,0.18)",
          borderRadius: "3px",
          boxShadow: "0 2px 8px rgba(15,23,42,0.14)",
          color: "#111827",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "12px",
          fontWeight: 600,
          lineHeight: "18px",
          minWidth: "42px",
          padding: "1px 6px",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </div>
    </Html>
  );
}

function ScaleDimensionGuides({
  box,
  activeDir,
  wsSettings,
}: {
  box: DimensionBoxState;
  activeDir: string;
  wsSettings?: import("../../types/workspace").WorkspaceSettings;
}) {
  const min = new THREE.Vector3(...box.min);
  const max = new THREE.Vector3(...box.max);
  const size = max.clone().sub(min);
  const dims = {
    x: Math.abs(box.baseSize[0] * box.scale[0]),
    y: Math.abs(box.baseSize[1] * box.scale[1]),
    z: Math.abs(box.baseSize[2] * box.scale[2]),
  };
  const sx = Math.max(Math.abs(box.scale[0]), 0.001);
  const sy = Math.max(Math.abs(box.scale[1]), 0.001);
  const sz = Math.max(Math.abs(box.scale[2]), 0.001);
  const worldFootprint = Math.max(dims.x, dims.z);
  const worldGuideGap = Math.max(0.45, Math.min(1.1, worldFootprint * 0.08));
  const worldTick = Math.max(0.18, Math.min(0.38, worldFootprint * 0.025));
  const gapX = worldGuideGap / sx;
  const gapZ = worldGuideGap / sz;
  const tickX = worldTick / sx;
  const tickY = worldTick / sy;
  const tickZ = worldTick / sz;
  const floorY = min.y + 0.035 / sy;
  const xGuideZ = max.z + gapZ;
  const zGuideX = max.x + gapX;
  const heightGuideX = max.x + gapX;
  const heightGuideZ = min.z;
  const materialColor = "#1f2937";
  const guideColor = "#334155";
  const showHeight = activeDir.includes("y");
  const showFloor = activeDir.includes("x") || activeDir.includes("z");

  const scale = wsSettings?.scale || "1:1";
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

  return (
    <group>
      {showFloor && (
        <>
          <Line
            points={[
              [min.x, floorY, xGuideZ],
              [max.x, floorY, xGuideZ],
            ]}
            color={materialColor}
            lineWidth={2}
          />
          <Line
            points={[
              [min.x, floorY, max.z],
              [min.x, floorY, xGuideZ + tickZ],
            ]}
            color={guideColor}
            lineWidth={1.2}
          />
          <Line
            points={[
              [max.x, floorY, max.z],
              [max.x, floorY, xGuideZ + tickZ],
            ]}
            color={guideColor}
            lineWidth={1.2}
          />
          <DimensionLabel
            position={[min.x + size.x / 2, floorY + tickY * 0.35, xGuideZ + tickZ * 0.9]}
          >
            {`W: ${(dims.x / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1)}${unitLabel}`}
          </DimensionLabel>

          <Line
            points={[
              [zGuideX, floorY, min.z],
              [zGuideX, floorY, max.z],
            ]}
            color={materialColor}
            lineWidth={2}
          />
          <Line
            points={[
              [max.x, floorY, min.z],
              [zGuideX + tickX, floorY, min.z],
            ]}
            color={guideColor}
            lineWidth={1.2}
          />
          <Line
            points={[
              [max.x, floorY, max.z],
              [zGuideX + tickX, floorY, max.z],
            ]}
            color={guideColor}
            lineWidth={1.2}
          />
          <DimensionLabel
            position={[zGuideX + tickX * 1.25, floorY + tickY * 0.35, min.z + size.z / 2]}
          >
            {`D: ${(dims.z / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1)}${unitLabel}`}
          </DimensionLabel>
        </>
      )}

      {showHeight && (
        <>
          <Line
            points={[
              [heightGuideX, min.y, heightGuideZ],
              [heightGuideX, max.y, heightGuideZ],
            ]}
            color={materialColor}
            lineWidth={2}
          />
          <Line
            points={[
              [heightGuideX - tickX, min.y, heightGuideZ],
              [heightGuideX + tickX, min.y, heightGuideZ],
            ]}
            color={guideColor}
            lineWidth={1.2}
          />
          <Line
            points={[
              [heightGuideX - tickX, max.y, heightGuideZ],
              [heightGuideX + tickX, max.y, heightGuideZ],
            ]}
            color={guideColor}
            lineWidth={1.2}
          />
          <DimensionLabel
            position={[heightGuideX + tickX * 1.9, min.y + size.y / 2, heightGuideZ]}
          >
            {`H: ${(dims.y / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1)}${unitLabel}`}
          </DimensionLabel>
        </>
      )}
    </group>
  );
}

function SingleScaleHandle({
  dir,
  pos,
  color,
  shape,
  meshRef,
  localBoxRef,
  dimensionDragActiveRef,
  setActiveDimensionDir,
  startScaleDrag,
}: {
  dir: string;
  pos: [number, number, number];
  color: string;
  shape: ShapeType;
  meshRef: React.MutableRefObject<THREE.Group | null>;
  localBoxRef: React.MutableRefObject<THREE.Box3>;
  dimensionDragActiveRef: React.MutableRefObject<boolean>;
  setActiveDimensionDir: React.Dispatch<React.SetStateAction<string | null>>;
  startScaleDrag: any;
}) {
  const [hovered, setHovered] = useState(false);
  const boxRef = useRef<THREE.Mesh>(null);
  const hoverScaleRef = useRef(1.0);

  const handleBoxSize = 0.35;

  useFrame((state) => {
    const obj = meshRef.current;
    if (!obj || !boxRef.current) return;
    const scaleObj = obj.userData.scaleGroup || obj;
    const sx = scaleObj.scale.x || 1;
    const sy = scaleObj.scale.y || 1;
    const sz = scaleObj.scale.z || 1;
    const box = localBoxRef.current;
    const boxSize = new THREE.Vector3();
    const boxCenter = new THREE.Vector3();
    box.getSize(boxSize);
    box.getCenter(boxCenter);

    boxRef.current.parent?.position.set(
      boxCenter.x + pos[0] * boxSize.x,
      boxCenter.y + pos[1] * boxSize.y,
      boxCenter.z + pos[2] * boxSize.z,
    );

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

    boxRef.current.scale.set(
      size / sx,
      size / sy,
      size / sz,
    );
  });

  return (
    <group position={pos}>
      <mesh
        ref={boxRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          setActiveDimensionDir(dir);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          if (!dimensionDragActiveRef.current) {
            setActiveDimensionDir(null);
          }
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dimensionDragActiveRef.current = true;
          setActiveDimensionDir(dir);
          startScaleDrag(e, shape, dir);
        }}
      >
        <boxGeometry />
        <meshBasicMaterial
          color={hovered ? "#fbbf24" : color}
          depthTest={false}
          transparent
          opacity={0.9}
        />
        <Edges color={hovered ? "#d97706" : (color === "#0f172a" ? "#cbd5e1" : "#1e293b")} />
        {/* Invisible over-sized hit target. The visible handle is tiny
            (~0.35 world units), so a slightly-off click used to fall straight
            through to whatever shape sits behind it and reselect it. r3f
            walks up to this mesh's parent for the pointer handlers, so a
            near-miss inside this box still starts the scale drag. */}
        <mesh scale={2.8}>
          <boxGeometry />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </mesh>
    </group>
  );
}
