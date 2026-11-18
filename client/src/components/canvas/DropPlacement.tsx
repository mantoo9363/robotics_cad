import React, { Suspense, useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  computeDropTransform,
  getLoadedGlbHalfHeight,
  getShapeHalfHeight,
} from "./utils/placementUtils";

export type DropPayload =
  | { kind: "shape"; type: string }
  | { kind: "glb"; url: string };

export type PendingDrop = {
  clientX: number;
  clientY: number;
  payload: DropPayload;
};

type DropPlacementProps = {
  pendingDrop: PendingDrop | null;
  onConsumed: () => void;
  addShape: (type: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
  addGlbShape: (url: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
};

// A GLB's real footprint isn't known until it loads, so its drop transform
// can't be computed in the same synchronous pass as a primitive's. This
// mounts only for a glb drop, resolves once useGLTF's Suspense clears (the
// same asset the panel's thumbnail and the drag ghost already loaded, so
// this is normally a cache hit, not a fresh fetch), and performs the actual
// placement then — using the model's own bounding box instead of a
// cube-shaped guess. See DropPlacement's old getShapeHalfHeight fallback,
// which guessed SPAWN_SCALE / 2 for every GLB and left flat models
// (cogwheels, SimLab gears) floating at a cube's height instead of their own.
function GlbDropResolver({
  url,
  ray,
  scene,
  camera,
  addGlbShape,
  onDone,
}: {
  url: string;
  ray: THREE.Ray;
  scene: THREE.Object3D;
  camera: THREE.Camera;
  addGlbShape: (url: string, pos?: [number, number, number], rot?: [number, number, number]) => void;
  onDone: () => void;
}) {
  const gltf = useGLTF(url) as any;
  // This component is freshly mounted (with a drop-unique key) per drop, and
  // StrictMode's dev-only double-invoke of a fresh mount's effects would
  // otherwise call addGlbShape twice for one drop. The ref survives that
  // synthetic remount, so it still catches the duplicate.
  const placedRef = useRef(false);

  useEffect(() => {
    if (placedRef.current) return;
    placedRef.current = true;
    const halfHeight = getLoadedGlbHalfHeight(gltf.scene);
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(ray);
    // LineSegments2 (the grid's fat lines) reads raycaster.camera directly
    // during intersection tests — a freshly constructed Raycaster never sets
    // it, unlike the shared one useThree() hands out, and raycasting against
    // the grid throws without it.
    raycaster.camera = camera as any;
    const { pos, rot } = computeDropTransform(raycaster, scene, halfHeight);
    addGlbShape(url, pos, rot);
    onDone();
    // Runs exactly once per resolver instance (keyed by drop in the parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene]);

  return null;
}

export default function DropPlacement({
  pendingDrop,
  onConsumed,
  addShape,
  addGlbShape,
}: DropPlacementProps) {
  const { raycaster, camera, scene, gl } = useThree();

  // A snapshot of the drop's ray. A GLB resolver may have to wait a frame or
  // more for Suspense before it can compute a position, so it works off this
  // frozen ray rather than the shared useThree() raycaster, which
  // GhostPreview's own per-frame raycast keeps moving in the meantime.
  const [rayAtDrop, setRayAtDrop] = useState<THREE.Ray | null>(null);

  useEffect(() => {
    if (!pendingDrop) {
      setRayAtDrop(null);
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((pendingDrop.clientX - rect.left) / rect.width) * 2 - 1,
      -((pendingDrop.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray.clone();
    setRayAtDrop(ray);

    if (pendingDrop.payload.kind !== "shape") return;

    const halfHeight = getShapeHalfHeight(pendingDrop.payload.type);
    const dropRaycaster = new THREE.Raycaster();
    dropRaycaster.ray.copy(ray);
    dropRaycaster.camera = camera as any;
    const { pos, rot } = computeDropTransform(dropRaycaster, scene, halfHeight);
    addShape(pendingDrop.payload.type, pos, rot);
    onConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDrop]);

  if (!pendingDrop || !rayAtDrop || pendingDrop.payload.kind !== "glb") return null;

  return (
    <Suspense fallback={null}>
      <GlbDropResolver
        key={`${pendingDrop.clientX}-${pendingDrop.clientY}-${pendingDrop.payload.url}`}
        url={pendingDrop.payload.url}
        ray={rayAtDrop}
        scene={scene}
        camera={camera}
        addGlbShape={addGlbShape}
        onDone={onConsumed}
      />
    </Suspense>
  );
}
