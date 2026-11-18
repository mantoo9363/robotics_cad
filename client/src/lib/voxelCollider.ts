import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

// Voxelization can issue thousands of raycasts against the shape's own
// mesh. Plain THREE.Raycaster does a brute-force per-triangle test, which
// measured ~3.2s for a moderately complex real shape (a block with 4
// holes, ~5000 sample points) — long enough to be a bad hold on a
// kinematic body. three-mesh-bvh (already a dependency of this project via
// three-bvh-csg) turns that into an O(log n) test per ray via a bounds
// tree; the same case measured ~70ms with it. This patch is standard
// three-mesh-bvh usage and, since this module only ever runs inside the
// dedicated voxelization Web Worker, is scoped to that worker's own global
// object — it does not touch the main thread's THREE usage.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type VoxelBox = {
  // Local-space center and half-extents of one merged box.
  center: [number, number, number];
  halfExtents: [number, number, number];
  volume: number;
};

export type FeatureRegion = {
  // Local-space padded bounding box of a known hole/cavity (e.g. from a
  // CSG isHole member). Voxelized independently, at its own resolution,
  // so its cost is bounded by the feature's own size rather than the
  // overall shape's — a hole that's tiny relative to a large shape still
  // gets resolved without needing a whole-shape fine grid.
  min: [number, number, number];
  max: [number, number, number];
};

type InsideTest = (point: THREE.Vector3) => boolean;

/**
 * Builds a robust inside/outside test for a closed mesh via ray-parity.
 * DoubleSide is required: a ray cast outward from inside a closed mesh only
 * ever hits back-faces on its way out, which a FrontSide-only material
 * would silently cull, making every inside point falsely test as outside.
 * Casts along 3 axis directions and takes the majority vote, since a
 * single-direction parity test can misfire on rays that graze an edge or
 * vertex exactly.
 */
export function makeInsideTest(geometry: THREE.BufferGeometry): InsideTest {
  if (!(geometry as any).boundsTree) {
    (geometry as any).computeBoundsTree();
  }
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 1e6;
  const dirs = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0.0001).normalize(),
    new THREE.Vector3(0.0001, 0, 1).normalize(),
  ];
  return (point: THREE.Vector3) => {
    let votes = 0;
    for (const dir of dirs) {
      raycaster.set(point, dir);
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length % 2 === 1) votes++;
    }
    return votes >= 2;
  };
}

type VoxelGrid = {
  inside: Uint8Array;
  nx: number;
  ny: number;
  nz: number;
  // Per-axis voxel size — NOT a shared scalar. A shape's axes can have very
  // different extents (e.g. a long thin bracket); deriving one voxel size
  // from the longest axis and reusing it on a thin axis can round that
  // axis's voxel count down to 1 while the voxel itself is still sized for
  // the long axis, placing that axis's only sample point past the shape's
  // actual edge — a false "empty" read for the entire grid. Sizing each
  // axis as (that axis's real extent / its own voxel count) makes every
  // sample point fall inside the box by construction, regardless of aspect
  // ratio.
  voxelSize: THREE.Vector3;
  origin: THREE.Vector3; // world-space position of voxel (0,0,0)'s min corner
};

/**
 * Computes how many voxels a grid gets per axis, and each axis's resulting
 * voxel size. Pulled out of sampleGrid so callers can know the *actual*
 * per-axis voxel size in advance (e.g. to pad a feature region correctly)
 * without duplicating this math — a shape's axes can end up with very
 * different voxel sizes (a thin axis clamped to a single full-span voxel
 * while a long axis gets many small ones), so a single shared scalar is
 * never a safe stand-in for "the" voxel size.
 */
function computeGridDims(
  size: THREE.Vector3,
  targetVoxelSize: number,
  maxVoxels: number,
): { nx: number; ny: number; nz: number; voxelSize: THREE.Vector3 } {
  let nx = Math.max(1, Math.round(size.x / targetVoxelSize));
  let ny = Math.max(1, Math.round(size.y / targetVoxelSize));
  let nz = Math.max(1, Math.round(size.z / targetVoxelSize));

  if (nx * ny * nz > maxVoxels) {
    // Coarsen uniformly rather than skip the region — callers are expected
    // to keep regions small enough (feature regions) or accept coarsening
    // (the whole-shape bulk grid) rather than rely on this branch to save
    // an under-sized region.
    const volume = size.x * size.y * size.z;
    const coarser = Math.cbrt(volume / maxVoxels);
    nx = Math.max(1, Math.round(size.x / coarser));
    ny = Math.max(1, Math.round(size.y / coarser));
    nz = Math.max(1, Math.round(size.z / coarser));
  }

  return { nx, ny, nz, voxelSize: new THREE.Vector3(size.x / nx, size.y / ny, size.z / nz) };
}

function sampleGrid(
  insideTest: InsideTest,
  min: THREE.Vector3,
  size: THREE.Vector3,
  targetVoxelSize: number,
  maxVoxels: number,
  // Excludes a voxel by its full CELL extent, not just its sample point.
  // Required for the bulk grid: a coarse bulk voxel can be larger than an
  // entire (small) feature region, so its center can sit outside that
  // region — and sample as genuinely solid — while the voxel's own extent
  // still spans across the region. Emitting that voxel as a box would
  // paper right back over the hole the feature grid carved out. Excluding
  // by cell overlap, not center containment, is what actually prevents that.
  excludeCell?: (cellMin: THREE.Vector3, cellMax: THREE.Vector3) => boolean,
): VoxelGrid | null {
  const { nx, ny, nz, voxelSize } = computeGridDims(size, targetVoxelSize, maxVoxels);
  const total = nx * ny * nz;
  if (total === 0) return null;

  const inside = new Uint8Array(total);
  const p = new THREE.Vector3();
  const cellMin = new THREE.Vector3();
  const cellMax = new THREE.Vector3();
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        if (excludeCell) {
          cellMin.set(min.x + ix * voxelSize.x, min.y + iy * voxelSize.y, min.z + iz * voxelSize.z);
          cellMax.set(cellMin.x + voxelSize.x, cellMin.y + voxelSize.y, cellMin.z + voxelSize.z);
          if (excludeCell(cellMin, cellMax)) continue;
        }
        p.set(
          min.x + (ix + 0.5) * voxelSize.x,
          min.y + (iy + 0.5) * voxelSize.y,
          min.z + (iz + 0.5) * voxelSize.z,
        );
        if (insideTest(p)) {
          inside[ix * ny * nz + iy * nz + iz] = 1;
        }
      }
    }
  }

  return { inside, nx, ny, nz, voxelSize, origin: min.clone() };
}

/**
 * Greedily grows axis-aligned boxes over the "inside" voxels of a grid:
 * from each unconsumed inside voxel, extend as far as possible along X,
 * then extend that X-run along Y as far as the whole run stays inside, then
 * extend the resulting XY-slab along Z the same way. Non-optimal (won't
 * always find the minimum box count) but simple to get correct, which is
 * what a collider approximation needs — not a minimal box count.
 */
function greedyMergeGrid(grid: VoxelGrid): VoxelBox[] {
  const { inside, nx, ny, nz, voxelSize, origin } = grid;
  const consumed = new Uint8Array(inside.length);
  const idx = (x: number, y: number, z: number) => x * ny * nz + y * nz + z;
  const boxes: VoxelBox[] = [];

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const start = idx(ix, iy, iz);
        if (!inside[start] || consumed[start]) continue;

        // Extend along X
        let ex = ix;
        while (ex + 1 < nx && inside[idx(ex + 1, iy, iz)] && !consumed[idx(ex + 1, iy, iz)]) {
          ex++;
        }

        // Extend the [ix..ex] X-run along Y
        let ey = iy;
        outerY: while (ey + 1 < ny) {
          for (let x = ix; x <= ex; x++) {
            const i = idx(x, ey + 1, iz);
            if (!inside[i] || consumed[i]) break outerY;
          }
          ey++;
        }

        // Extend the [ix..ex, iy..ey] XY-slab along Z
        let ez = iz;
        outerZ: while (ez + 1 < nz) {
          for (let x = ix; x <= ex; x++) {
            for (let y = iy; y <= ey; y++) {
              const i = idx(x, y, ez + 1);
              if (!inside[i] || consumed[i]) break outerZ;
            }
          }
          ez++;
        }

        // Mark consumed and emit the box
        for (let x = ix; x <= ex; x++) {
          for (let y = iy; y <= ey; y++) {
            for (let z = iz; z <= ez; z++) {
              consumed[idx(x, y, z)] = 1;
            }
          }
        }

        const sizeX = (ex - ix + 1) * voxelSize.x;
        const sizeY = (ey - iy + 1) * voxelSize.y;
        const sizeZ = (ez - iz + 1) * voxelSize.z;
        boxes.push({
          center: [
            origin.x + ix * voxelSize.x + sizeX / 2,
            origin.y + iy * voxelSize.y + sizeY / 2,
            origin.z + iz * voxelSize.z + sizeZ / 2,
          ],
          halfExtents: [sizeX / 2, sizeY / 2, sizeZ / 2],
          volume: sizeX * sizeY * sizeZ,
        });
      }
    }
  }

  return boxes;
}

// Starting resolution — deliberately high. A flat density constant is the
// wrong lever: a simple shape (one gear) naturally merges down to a handful
// of boxes at this resolution regardless, so it loses nothing; a genuinely
// detailed/complex import is the only case that would actually produce an
// unmanageable box count. Rather than punish every shape with a low ceiling
// to guard against that one case, MAX_FINAL_BOXES below backs resolution
// off automatically, and only for the shapes that actually need it — see
// buildVoxelCompoundColliders's retry loop.
const DEFAULT_BULK_VOXELS_ALONG_LONGEST_AXIS = 64;
const DEFAULT_BULK_MAX_VOXELS = 150000;
const DEFAULT_FEATURE_VOXELS_ACROSS = 14;
const DEFAULT_FEATURE_MAX_VOXELS = 40000;
const FEATURE_PADDING_FACTOR = 1.25;

// The real cost driver isn't voxel-grid resolution — it's how many boxes
// survive the greedy merge, since each one becomes its own <CuboidCollider>
// React element plus a broad-phase entry Rapier has to track every step.
// That count depends on shape complexity, not just resolution, so it can't
// be bounded up front the way voxel *cell* count can (computeGridDims
// already does that, but pre-merge cell count and post-merge box count
// don't track each other closely for an intricate shape). Capping the
// final result and retrying coarser when it's exceeded is what actually
// keeps a browser tab from choking on a sufficiently detailed import,
// without taking resolution away from every simpler shape that never gets
// near this ceiling in the first place.
const MAX_FINAL_BOXES = 350;
const RETRY_COARSEN_FACTOR = 1.6; // grows voxel size (shrinks resolution) each retry
const MAX_RESOLUTION_RETRIES = 4;

/**
 * Builds a compound of CuboidCollider-ready boxes approximating a mesh's
 * true solid volume, including holes/cavities a single convex hull can't
 * represent. Two-tier resolution: known feature regions (from CSG isHole
 * members) get their own independently-sized fine grid, bounded by the
 * feature's own size; everything else uses one coarse grid sized off the
 * whole shape. This is what actually distinguishes this from a single
 * uniform grid — a hole that's tiny relative to a large overall shape
 * still gets resolved, because its grid's cost only depends on its own
 * size, not the shape's.
 *
 * Voxels whose centers fall inside a feature region are excluded from the
 * bulk grid (skipped, not sampled) so the two grids don't double-count or
 * fight — the feature grid is solely responsible for that space.
 */
export function buildVoxelCompoundColliders(
  geometry: THREE.BufferGeometry,
  featureRegions: FeatureRegion[] = [],
): VoxelBox[] {
  geometry.computeBoundingBox();
  if (!geometry.boundingBox) return [];
  // Rebound as a fresh const so TS's null-narrowing survives into the
  // nested buildAtResolution closure below (narrowing on the original
  // `geometry.boundingBox` property access doesn't).
  const bbox = geometry.boundingBox;

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const longestAxis = Math.max(size.x, size.y, size.z);
  if (longestAxis <= 0) return [];

  // Built once, reused across every resolution attempt below — it depends
  // only on the source geometry, not on grid resolution, so there's no
  // reason to rebuild the BVH per retry.
  const insideTest = makeInsideTest(geometry);

  let boxes: VoxelBox[] = [];
  let voxelsAlongLongestAxis = DEFAULT_BULK_VOXELS_ALONG_LONGEST_AXIS;
  // Feature (hole/thin-wall) resolution deliberately does NOT get coarsened
  // by the retry loop below, unlike the bulk grid. A known feature region is
  // small by construction (its own grid is sized off the feature itself,
  // not the whole shape), so it's never the reason a shape blows past
  // MAX_FINAL_BOXES — the bulk grid over a large/complex shape is. But a
  // thin wall (e.g. a collar meant to fit around a shaft) genuinely needs
  // enough voxels across its own thickness to stay a *closed* ring at all;
  // coarsening it under box-count pressure can open real gaps a fast-moving
  // body then finds and passes through, independent of anything CCD-related.
  const featureVoxelsAcross = DEFAULT_FEATURE_VOXELS_ACROSS;

  for (let attempt = 0; attempt <= MAX_RESOLUTION_RETRIES; attempt++) {
    boxes = buildAtResolution(voxelsAlongLongestAxis, featureVoxelsAcross);
    if (boxes.length <= MAX_FINAL_BOXES || attempt === MAX_RESOLUTION_RETRIES) break;
    // Coarsen and try again — a shape whose real complexity produces this
    // many boxes even at a lower resolution genuinely needs it backed off
    // further, not a shape this ceiling should ever apply to at the
    // starting resolution (most shapes merge well under it there).
    voxelsAlongLongestAxis = Math.max(4, Math.round(voxelsAlongLongestAxis / RETRY_COARSEN_FACTOR));
  }

  return boxes;

  function buildAtResolution(voxelsAlongLongestAxis: number, featureVoxelsAcross: number): VoxelBox[] {
    const bulkVoxelTarget = longestAxis / voxelsAlongLongestAxis;
    // The *actual* per-axis bulk voxel size, not the shared target scalar —
    // an elongated shape's thin axes get clamped to far fewer voxels than
    // the target implies (e.g. a whole axis in one voxel), so their true
    // voxel size can be very different from the long axis's. Padding a
    // feature region by the wrong axis's voxel size either wastes fine-grid
    // resolution (padding too big) or reopens the exact gap this is meant to
    // close (padding too small).
    const bulkVoxelSize = computeGridDims(size, bulkVoxelTarget, DEFAULT_BULK_MAX_VOXELS).voxelSize;

    const pad = (r: FeatureRegion, halfExtra: (half: THREE.Vector3) => THREE.Vector3) => {
      const min = new THREE.Vector3(...r.min);
      const max = new THREE.Vector3(...r.max);
      const center = min.clone().add(max).multiplyScalar(0.5);
      const half = halfExtra(max.clone().sub(min).multiplyScalar(0.5));
      return { min: center.clone().sub(half), max: center.clone().add(half) };
    };

    // Two region sizes per hole, not one — this is what avoids a circular
    // padding problem. If the same padded region were used both to decide
    // which bulk voxels to exclude AND as the fine grid's own coverage area,
    // any fixed padding could still be defeated: a bulk voxel just outside
    // that region's edge still gets excluded (for touching it), but its own
    // far edge reaches past the region — leaving a gap of genuinely solid
    // material that neither grid covers. Excluding on the SMALLER region and
    // covering with the LARGER (padded by one full bulk-voxel-width beyond
    // that) guarantees any voxel that can possibly be excluded is fully
    // contained within what the fine grid actually samples.
    const exclusionRegions = featureRegions.map((r) =>
      pad(r, (half) => half.multiplyScalar(FEATURE_PADDING_FACTOR)),
    );
    const coverageRegions = featureRegions.map((r) =>
      pad(r, (half) =>
        half.multiplyScalar(FEATURE_PADDING_FACTOR).add(bulkVoxelSize),
      ),
    );

    // AABB-overlap test (not point containment) — a bulk cell must be
    // excluded if it touches a feature region at all, since the box emitted
    // from that cell will span its full extent regardless of where its
    // sample point happened to land.
    const cellOverlapsAnyExclusionRegion = (cellMin: THREE.Vector3, cellMax: THREE.Vector3) =>
      exclusionRegions.some(
        (r) =>
          cellMax.x >= r.min.x && cellMin.x <= r.max.x &&
          cellMax.y >= r.min.y && cellMin.y <= r.max.y &&
          cellMax.z >= r.min.z && cellMin.z <= r.max.z,
      );

    const localBoxes: VoxelBox[] = [];

    // --- Fine grid per feature region, sampled over the larger coverage area ---
    for (const region of coverageRegions) {
      const regionSize = region.max.clone().sub(region.min);
      const smallestDim = Math.min(regionSize.x, regionSize.y, regionSize.z);
      if (smallestDim <= 0) continue;
      const voxelSize = smallestDim / featureVoxelsAcross;
      const grid = sampleGrid(insideTest, region.min, regionSize, voxelSize, DEFAULT_FEATURE_MAX_VOXELS);
      if (grid) localBoxes.push(...greedyMergeGrid(grid));
    }

    // --- Coarse bulk grid over the whole shape, excluding any cell that
    // overlaps the (smaller) exclusion region — not just cells whose center
    // falls inside one — so a large bulk voxel can never span across and
    // repaint a hole the fine grid already carved out ---
    const bulkGrid = sampleGrid(
      insideTest,
      bbox.min,
      size,
      bulkVoxelTarget,
      DEFAULT_BULK_MAX_VOXELS,
      cellOverlapsAnyExclusionRegion,
    );
    if (bulkGrid) {
      // The bulk boxes overlap the fine grids by design: cells are excluded on
      // the SMALLER exclusion region but the fine grid samples the LARGER
      // coverage region, and that asymmetry is deliberate — it is what
      // guarantees no gaps (see the comment on coverageRegions). The cost is
      // that the margin band is represented twice.
      //
      // Overlapping colliders are harmless to Rapier, but `volume` is what
      // callers turn into per-collider mass fractions, so double-counting that
      // band biases the shape's centre of mass toward its hole rims. Charging
      // each bulk box only for the material the fine grid is NOT already
      // accounting for fixes the distribution without touching the collider
      // geometry that the no-gap guarantee depends on. See BUG-016.
      for (const b of greedyMergeGrid(bulkGrid)) {
        localBoxes.push({ ...b, volume: volumeOutsideRegions(b, coverageRegions) });
      }
    }

    return localBoxes;
  }
}

/**
 * A box's volume minus the part of it already covered by the fine grids.
 *
 * Coverage regions for distinct holes are effectively disjoint in practice, so
 * the overlaps are summed rather than unioned; the result is clamped at zero so
 * a box swallowed by several regions cannot go negative and flip the sign of a
 * mass fraction.
 */
function volumeOutsideRegions(
  box: VoxelBox,
  regions: Array<{ min: THREE.Vector3; max: THREE.Vector3 }>,
): number {
  if (regions.length === 0) return box.volume;
  const min = [
    box.center[0] - box.halfExtents[0],
    box.center[1] - box.halfExtents[1],
    box.center[2] - box.halfExtents[2],
  ];
  const max = [
    box.center[0] + box.halfExtents[0],
    box.center[1] + box.halfExtents[1],
    box.center[2] + box.halfExtents[2],
  ];

  let covered = 0;
  for (const r of regions) {
    const rMin = [r.min.x, r.min.y, r.min.z];
    const rMax = [r.max.x, r.max.y, r.max.z];
    let overlap = 1;
    for (let a = 0; a < 3; a++) {
      const span = Math.min(max[a], rMax[a]) - Math.max(min[a], rMin[a]);
      if (span <= 0) {
        overlap = 0;
        break;
      }
      overlap *= span;
    }
    covered += overlap;
  }
  return Math.max(0, box.volume - covered);
}
