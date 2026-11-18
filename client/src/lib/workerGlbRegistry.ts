import * as THREE from "three";

// Shared main-thread <-> Worker GLB geometry conversion. Any worker that
// needs to resolve a "glb" CustomMember/ShapeType reference (currently: the
// CSG worker — see csgEvaluation.ts) uses these two functions rather than
// inventing its own flatten/rebuild pair. A THREE.BufferGeometry itself
// can't cross postMessage; these are the two halves of doing it as raw
// typed arrays instead.
//
// Deliberately NOT wired into the voxel-collider worker
// (workers/voxelColliderWorker.ts / lib/useVoxelCollider.ts) in this pass.
// That worker never receives a GLB reference at all: buildGlbShapeVoxelInput
// and buildCustomShapeVoxelInput already flatten GLB/CSG geometry to
// positions/indices synchronously on the main thread, before compute() is
// ever called (see hollowShapeVoxelization.ts). It has no "GLB registry"
// protocol to share this with, and changing that would mean modifying an
// already-shipped, audited (BUG-009/010/012/014) worker protocol for a cost
// this profiling pass never measured as a problem. What's shared is this
// pure conversion module, not a live registry between two running workers.
export type GlbGeometryArrays = {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint32Array | Uint16Array;
};

/**
 * Main-thread side: flattens an already-resolved GLB geometry (e.g. an entry
 * from Canvas3D.tsx's `gltfGeometryMap` — merged, centered, unit-scaled) into
 * plain arrays a worker can receive. Does NOT redo any of that
 * normalization; it only copies out what's already there, so the worker's
 * reconstructed geometry is equivalent to, not a reprocessing of, the
 * caller's.
 */
export function extractGlbArrays(geometry: THREE.BufferGeometry): GlbGeometryArrays {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const norm = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const idx = geometry.index;
  if (!pos) {
    throw new Error("[workerGlbRegistry] geometry has no position attribute to extract");
  }
  return {
    positions: new Float32Array(pos.array as ArrayLike<number>),
    normals: norm ? new Float32Array(norm.array as ArrayLike<number>) : undefined,
    uvs: uv ? new Float32Array(uv.array as ArrayLike<number>) : undefined,
    indices: idx
      ? idx.array instanceof Uint16Array
        ? new Uint16Array(idx.array)
        : new Uint32Array(idx.array as ArrayLike<number>)
      : undefined,
  };
}

/**
 * Worker side: rebuilds a THREE.BufferGeometry from extractGlbArrays's
 * output. BufferGeometry/BufferAttribute are plain data containers with no
 * renderer or DOM dependency, so this is safe to call inside a Worker.
 */
export function reconstructGlbGeometry(arrays: GlbGeometryArrays): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(arrays.positions, 3));
  if (arrays.normals) {
    geom.setAttribute("normal", new THREE.BufferAttribute(arrays.normals, 3));
  }
  if (arrays.uvs) {
    geom.setAttribute("uv", new THREE.BufferAttribute(arrays.uvs, 2));
  }
  if (arrays.indices) {
    geom.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  }
  return geom;
}

/**
 * Transferable list for a postMessage carrying `arrays`. Callers that still
 * need their own copy of `arrays` afterward (e.g. because the source
 * geometry outlives this one registration call) must pass copies here, not
 * the live buffers — transferring detaches them from the sender. See
 * useVoxelCollider.ts's `positions.slice()` for the precedent this follows.
 */
export function transferablesFor(arrays: GlbGeometryArrays): Transferable[] {
  const list: Transferable[] = [arrays.positions.buffer];
  if (arrays.normals) list.push(arrays.normals.buffer);
  if (arrays.uvs) list.push(arrays.uvs.buffer);
  if (arrays.indices) list.push(arrays.indices.buffer);
  return list;
}
