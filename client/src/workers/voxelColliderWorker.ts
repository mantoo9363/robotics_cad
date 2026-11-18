import * as THREE from "three";
import { buildVoxelCompoundColliders, type FeatureRegion, type VoxelBox } from "../lib/voxelCollider";

interface VoxelWorkMessage {
  id: number;
  positions: Float32Array;
  indices?: Uint32Array;
  featureRegions: FeatureRegion[];
}

interface VoxelResultMessage {
  id: number;
  boxes: VoxelBox[];
  error?: string;
}

// CSG evaluation for custom/CSG shapes happens on the main thread before a
// message ever reaches this worker (this app already renders hollow custom
// shapes synchronously today via evaluateCustomGeometry — that part isn't
// what's slow). This worker's only job is the voxelization/raycasting pass,
// which measured up to ~3.2s uncapped on a moderately complex shape and is
// the actual reason this needs to be off the main thread.
self.onmessage = (e: MessageEvent<VoxelWorkMessage>) => {
  const { id, positions, indices, featureRegions } = e.data;
  try {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (indices) geom.setIndex(new THREE.BufferAttribute(indices, 1));

    const boxes = buildVoxelCompoundColliders(geom, featureRegions);

    const msg: VoxelResultMessage = { id, boxes };
    (self as any).postMessage(msg);
  } catch (err: any) {
    const msg: VoxelResultMessage = { id, boxes: [], error: err?.message || String(err) };
    (self as any).postMessage(msg);
  }
};
