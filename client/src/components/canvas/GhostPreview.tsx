import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { DropPayload } from "./DropPlacement";
import { getCachedGeometry } from "../../lib/geometryCache";
import {
  computeDropTransform,
  getGlbHalfHeight,
  getShapeHalfHeight,
  SPAWN_SCALE,
} from "./utils/placementUtils";

const PRIMITIVE_PREVIEW_TYPES = new Set([
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "hexagon",
  "cogwheel",
  "cogwheel-6t",
  "cogwheel-8t",
  "cogwheel-12t",
  "cogwheel-16t",
]);

const GHOST_MATERIAL_PROPS = { color: "#38bdf8", transparent: true, opacity: 0.5, depthTest: false } as const;

function ShapeGhostMesh({ type }: { type: string }) {
  // Composite procedural shapes (pipe/lbracket/arch/stairs/bowl) aren't cheap
  // to CSG-evaluate every frame; approximate those with a unit box.
  const geometry = useMemo(
    () => (PRIMITIVE_PREVIEW_TYPES.has(type) ? getCachedGeometry(type, "medium") : new THREE.BoxGeometry(1, 1, 1)),
    [type],
  );
  return (
    <mesh scale={SPAWN_SCALE}>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial {...GHOST_MATERIAL_PROPS} />
    </mesh>
  );
}

function GlbGhostMesh({ url, onHalfHeight }: { url: string; onHalfHeight: (h: number) => void }) {
  const gltf = useGLTF(url) as any;

  const { wrapper, halfHeight } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node: any) => {
      if (node.isMesh) {
        node.material = new THREE.MeshStandardMaterial(GHOST_MATERIAL_PROPS);
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const sf = maxDim > 0 ? 1 / maxDim : 1;

    const w = new THREE.Group();
    clone.position.set(-center.x, -center.y, -center.z);
    w.scale.setScalar(sf);
    w.add(clone);

    return { wrapper: w, halfHeight: getGlbHalfHeight(size.y * sf) };
  }, [gltf.scene]);

  useEffect(() => {
    onHalfHeight(halfHeight);
  }, [halfHeight, onHalfHeight]);

  return (
    <group scale={SPAWN_SCALE}>
      <primitive object={wrapper} />
    </group>
  );
}

type GhostPreviewProps = {
  placementRequest: DropPayload | null;
  setPlacementRequest: React.Dispatch<React.SetStateAction<DropPayload | null>>;
  addShape: (type: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
  addGlbShape: (url: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
  // Screen-space pointer position to use instead of the R3F pointer, for
  // native HTML5 drag-and-drop (dragover doesn't update R3F's `mouse`).
  pointerOverride?: { x: number; y: number } | null;
};

export default function GhostPreview({
  placementRequest,
  setPlacementRequest,
  addShape,
  addGlbShape,
  pointerOverride,
}: GhostPreviewProps) {
  const { raycaster, mouse, scene, camera, gl } = useThree();
  const [pos, setPos] = useState<[number, number, number]>([0, SPAWN_SCALE / 2, 0]);
  const [rot, setRot] = useState<[number, number, number]>([0, 0, 0]);
  const [glbHalfHeight, setGlbHalfHeight] = useState(SPAWN_SCALE / 2);

  useEffect(() => {
    if (placementRequest?.kind === "glb") setGlbHalfHeight(SPAWN_SCALE / 2);
  }, [placementRequest?.kind === "glb" ? placementRequest.url : null]);

  const halfHeight = !placementRequest
    ? SPAWN_SCALE / 2
    : placementRequest.kind === "glb"
      ? glbHalfHeight
      : getShapeHalfHeight(placementRequest.type);

  useFrame(() => {
    if (!placementRequest) return;
    if (pointerOverride) {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((pointerOverride.x - rect.left) / rect.width) * 2 - 1,
        -((pointerOverride.y - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
    } else {
      raycaster.setFromCamera(mouse, camera);
    }
    const { pos: p, rot: r } = computeDropTransform(raycaster, scene, halfHeight);
    setPos(p);
    setRot(r);
  });

  useEffect(() => {
    if (!placementRequest) return;
    const onClick = (e: MouseEvent) => {
      if (e.target !== gl.domElement) return;
      if (placementRequest.kind === "shape") {
        addShape(placementRequest.type, pos, rot);
      } else {
        addGlbShape(placementRequest.url, pos, rot);
      }
      setPlacementRequest(null);
    };
    window.addEventListener("pointerdown", onClick);
    return () => window.removeEventListener("pointerdown", onClick);
  }, [placementRequest, pos, rot, addShape, addGlbShape, setPlacementRequest, gl]);

  if (!placementRequest) return null;

  return (
    <group position={pos} rotation={rot} userData={{ isPlacementPreview: true }}>
      <Suspense
        fallback={
          <mesh scale={SPAWN_SCALE}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial {...GHOST_MATERIAL_PROPS} />
          </mesh>
        }
      >
        {placementRequest.kind === "shape" ? (
          <ShapeGhostMesh type={placementRequest.type} />
        ) : (
          <GlbGhostMesh url={placementRequest.url} onHalfHeight={setGlbHalfHeight} />
        )}
      </Suspense>
    </group>
  );
}
