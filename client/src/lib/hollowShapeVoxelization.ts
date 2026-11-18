import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import { Evaluator } from "three-bvh-csg";
import type { ShapeType, CustomMember } from "../pages/CadStudio";
import { evaluateCustomGeometry } from "../components/canvas/utils/geometryHelpers";
import { getCachedGeometry } from "./geometryCache";
import type { FeatureRegion } from "./voxelCollider";

export type VoxelInput = {
  positions: Float32Array;
  indices?: Uint32Array;
  featureRegions: FeatureRegion[];
  cacheKey: string;
};

/**
 * Cycle guard for every walker over a `customMembers` tree, following the
 * same shape as getAssemblyRootId in canvas/utils/GrabbingSystem.ts — the one
 * walker in this codebase that already got this right: keep a `seen` set, and
 * bail on revisit instead of recursing forever.
 *
 * Two adaptations to that template, both forced by the data:
 *
 * 1. `CustomMember` has no id field, so membership is by object identity
 *    rather than by number. That is also exactly what a cycle requires here —
 *    `m.customMembers` has to physically contain `m` or one of its ancestors —
 *    so identity is the right key, not a structural hash.
 *
 * 2. The set is scoped to the current *path* (added before recursing, removed
 *    after) rather than to the whole traversal. A member tree is legitimately
 *    allowed to be a DAG: the same member object can appear twice as siblings,
 *    e.g. when the editor reuses one authored part in two places. A
 *    global "already visited" set would silently truncate the second
 *    occurrence and quietly drop real geometry; a path-scoped set only ever
 *    fires on a genuine ancestor cycle.
 *
 * Cyclic branches are treated as contributing nothing, on the reasoning that
 * anything reachable through the cycle was already reachable on the path that
 * led into it.
 */
type MemberPath = Set<CustomMember>;

/** True if any member (recursively) is flagged as a structural CSG hole. */
export function hasStructuralHoles(
  members: CustomMember[] | undefined,
  path: MemberPath = new Set(),
): boolean {
  if (!members) return false;
  return members.some((m) => {
    if (m.isHole) return true;
    if (m.type !== "custom" || !m.customMembers) return false;
    if (path.has(m)) return false; // cycle — this branch adds nothing new
    path.add(m);
    const found = hasStructuralHoles(m.customMembers, path);
    path.delete(m);
    return found;
  });
}

/**
 * Bounding box of a single hole member in the *root* shape's local space —
 * used as a known feature region for voxelization. Nested "custom" holes
 * fall back to a plain box over their own scale rather than fully resolving
 * their own CSG shape; feature regions only need to be a reasonable bound
 * for the fine grid, not an exact fit, so this is an acceptable estimate
 * for what should be a rare case (a hole that's itself a composite shape).
 */
function memberBboxInRootSpace(m: CustomMember, absoluteMatrix: THREE.Matrix4): FeatureRegion {
  const geom =
    m.type === "custom" || m.type === "glb"
      ? new THREE.BoxGeometry(1, 1, 1)
      : getCachedGeometry(m.type, "low").clone();
  geom.applyMatrix4(absoluteMatrix);
  geom.computeBoundingBox();
  const b = geom.boundingBox!;
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}

/**
 * Walks the member tree accumulating each level's own offset/rotation/scale
 * into a running matrix (same composition CSG evaluation itself uses), so a
 * hole nested inside a "custom" sub-assembly resolves to where it actually
 * ends up in the root shape — not just its own offset relative to its
 * immediate parent. Getting this wrong silently points the fine-grid
 * feature hint at the wrong location (or empty space), leaving the hole to
 * fall back to the coarse bulk grid's resolution — exactly the kind of
 * under-resolution that can leave real gaps in a thin wall (e.g. a collar
 * meant to fit around a shaft).
 */
function collectHoleRegions(
  members: CustomMember[] | undefined,
  parentMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  path: MemberPath = new Set(),
): FeatureRegion[] {
  if (!members) return [];
  const regions: FeatureRegion[] = [];
  for (const m of members) {
    const localMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...m.offset),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...m.rotation)),
      new THREE.Vector3(...m.scale),
    );
    const absoluteMatrix = parentMatrix.clone().multiply(localMatrix);
    if (m.isHole) regions.push(memberBboxInRootSpace(m, absoluteMatrix));
    if (m.type === "custom" && !path.has(m)) {
      path.add(m);
      regions.push(...collectHoleRegions(m.customMembers, absoluteMatrix, path));
      path.delete(m);
    }
  }
  return regions;
}

/**
 * Stable content key for a member tree. Exported because it is also the memo
 * key MemberCollider and VoxelizedShapeBody need: both used to call
 * `JSON.stringify(shape.customMembers)`, which throws outright on a cyclic
 * tree (BUG-030) and re-walks the whole tree on every render. This walks the
 * same data, is cycle-safe, and covers only the fields that actually change
 * the resulting geometry.
 *
 * A cycle serialises as the literal `<cycle>` rather than being dropped, so
 * two trees that differ only in where they loop back still produce different
 * keys — silently omitting it could collide two genuinely different shapes
 * onto one cache entry.
 */
export function serializeMembers(
  members: CustomMember[] | undefined,
  path: MemberPath = new Set(),
): string {
  if (!members) return "";
  return members
    .map((m) => {
      // Deliberately NOT gated on `m.type === "custom"`, unlike the walkers
      // above: the original serialiser recursed on any member carrying
      // customMembers, and narrowing that here would change the cache key for
      // trees that already exist in saved workspaces.
      let nested: string;
      if (!m.customMembers) {
        nested = "";
      } else if (path.has(m)) {
        nested = "<cycle>";
      } else {
        path.add(m);
        nested = serializeMembers(m.customMembers, path);
        path.delete(m);
      }
      return `${m.type}-${m.url || ""}-${m.offset.join(",")}-${m.rotation.join(",")}-${m.scale.join(",")}-${m.isHole}-${nested}`;
    })
    .join("|");
}

/**
 * Packages already-folded CSG geometry (raw positions/indices, in the
 * shape's own unscaled local space — exactly what evaluateCustomGeometry
 * produces before any scale is applied) into voxelization input: scales it,
 * computes feature regions, and builds the cache key. Split out of
 * buildCustomShapeVoxelInput below (which still does the fold itself,
 * synchronously) so a caller that folds asynchronously — MemberCollider.tsx
 * and VoxelizedShapeBody.tsx now do, via lib/useCSGWorker.ts — has a place
 * to hand its worker's result without duplicating this packaging logic.
 *
 * This half was never the slow part (it's array scaling and pure tree
 * walks, not a CSG evaluation) and stays synchronous — only the fold moved
 * off-thread.
 *
 * `foldedPositions.length === 0` (evaluateCustomGeometry's own convention
 * for "produced nothing," see geometryHelpers.ts) is treated as "no input,"
 * matching this function's original behavior of returning null for an
 * empty/degenerate bounding box.
 */
export function packageCustomShapeVoxelInput(
  shape: ShapeType,
  foldedPositions: Float32Array,
  foldedIndices?: Uint32Array | Uint16Array,
): VoxelInput | null {
  if (foldedPositions.length === 0) return null;

  const [sx, sy, sz] = shape.scale;
  const positions = new Float32Array(foldedPositions.length);
  for (let i = 0; i < foldedPositions.length; i += 3) {
    positions[i] = foldedPositions[i] * sx;
    positions[i + 1] = foldedPositions[i + 1] * sy;
    positions[i + 2] = foldedPositions[i + 2] * sz;
  }
  // VoxelInput only allows Uint32Array (not Uint16) — evaluateCustomGeometry's
  // fold can legitimately produce either depending on vertex count.
  const indices =
    foldedIndices && foldedIndices.length > 0
      ? foldedIndices instanceof Uint32Array
        ? foldedIndices
        : new Uint32Array(foldedIndices)
      : undefined;

  const featureRegions = collectHoleRegions(shape.customMembers).map((r) => ({
    min: [r.min[0] * sx, r.min[1] * sy, r.min[2] * sz] as [number, number, number],
    max: [r.max[0] * sx, r.max[1] * sy, r.max[2] * sz] as [number, number, number],
  }));

  const cacheKey = `custom-${shape.type}-${shape.scale.join(",")}-${serializeMembers(shape.customMembers)}`;

  return { positions, indices, featureRegions, cacheKey };
}

/**
 * Builds the voxelization input (final scaled geometry + feature regions +
 * a cache key) for a "custom" shape's CSG result, folding synchronously on
 * whatever thread calls it. Kept as the fully-synchronous reference
 * implementation — MemberCollider.tsx and VoxelizedShapeBody.tsx no longer
 * call this directly (they fold asynchronously via useCSGWorker and call
 * packageCustomShapeVoxelInput themselves), but it remains the equivalence
 * oracle packageCustomShapeVoxelInput is tested against, same role
 * evaluateCSGGroupGeometry (Step 3) and evaluateCustomGeometry (Step 2) play
 * for their own async counterparts.
 */
export function buildCustomShapeVoxelInput(
  shape: ShapeType,
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
): VoxelInput | null {
  if (!shape.customMembers || shape.customMembers.length === 0) return null;

  const geom = evaluateCustomGeometry(shape.customMembers, evaluator, gltfGeometryMap, shape.color);
  const positions = new Float32Array(geom.attributes.position.array);
  const indices = geom.index ? new Uint32Array(geom.index.array) : undefined;
  geom.dispose();

  return packageCustomShapeVoxelInput(shape, positions, indices);
}

/**
 * Builds voxelization input for a GLB import — no structural hole metadata
 * exists here (confirmed in investigation: only a triangulated mesh), so
 * there are no feature regions; the whole mesh voxelizes as one coarse grid.
 */
export function buildGlbShapeVoxelInput(
  shape: ShapeType,
  gltfGeometryMap: Map<string, THREE.BufferGeometry>,
): VoxelInput | null {
  if (!shape.url || !gltfGeometryMap.has(shape.url)) return null;
  const geom = gltfGeometryMap.get(shape.url)!.clone();
  geom.scale(shape.scale[0], shape.scale[1], shape.scale[2]);
  geom.computeBoundingBox();
  if (!geom.boundingBox || geom.boundingBox.isEmpty()) return null;

  const positions = new Float32Array(geom.attributes.position.array);
  const indices = geom.index ? new Uint32Array(geom.index.array) : undefined;
  const cacheKey = `glb-${shape.url}-${shape.scale.join(",")}`;

  return { positions, indices, featureRegions: [], cacheKey };
}

// Exported so other geometry-recognition utilities (e.g. the concentric-bore
// primitive-history decomposer) can reuse the same signed-tetrahedron volume
// calc instead of a second, driftable copy.
export function meshVolume(positions: Float32Array, indices?: Uint32Array | Uint16Array): number {
  let vol = 0;
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  for (let i = 0; i < triCount; i++) {
    const a = indices ? indices[i * 3] : i * 3;
    const b = indices ? indices[i * 3 + 1] : i * 3 + 1;
    const c = indices ? indices[i * 3 + 2] : i * 3 + 2;
    v0.set(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
    v1.set(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
    v2.set(positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]);
    vol += v0.dot(v1.clone().cross(v2)) / 6;
  }
  return Math.abs(vol);
}

function convexHullVolume(positions: Float32Array): number {
  const points: THREE.Vector3[] = [];
  const centroid = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    const p = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    points.push(p);
    centroid.add(p);
  }
  if (points.length < 4) return 0;
  centroid.divideScalar(points.length);
  const hull = new ConvexHull().setFromPoints(points);
  let vol = 0;
  for (const face of hull.faces) {
    const verts: THREE.Vector3[] = [];
    let edge = face.edge;
    const start = edge;
    do {
      verts.push(edge.head().point);
      edge = edge.next;
    } while (edge !== start);
    for (let i = 1; i < verts.length - 1; i++) {
      const a = verts[0].clone().sub(centroid);
      const b = verts[i].clone().sub(centroid);
      const c = verts[i + 1].clone().sub(centroid);
      vol += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return Math.abs(vol);
}

/**
 * Single trigger decision used by the render layer: does this shape need
 * the voxel-compound-collider path at all, or is the existing fast
 * single-hull/cuboid path (already correct for convex shapes) enough?
 * CSG shapes trigger unconditionally on structural isHole data — no
 * heuristic risk. GLB/no-metadata shapes fall back to the convexity check,
 * which is a real, accepted limitation for that case (see isGlbConcave).
 */
export function shouldVoxelizeShape(
  shape: ShapeType,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
): boolean {
  if (shape.type === "custom") {
    return hasStructuralHoles(shape.customMembers);
  }
  if (shape.type === "glb" && shape.url && gltfGeometryMap?.has(shape.url)) {
    const geom = gltfGeometryMap.get(shape.url)!;
    const positions = geom.attributes.position?.array as Float32Array | undefined;
    if (!positions || positions.length < 12) return false;
    const indices = geom.index?.array as Uint32Array | Uint16Array | undefined;
    return isGlbConcave(positions, indices);
  }
  return false;
}

// Confirmed via real measurement (box+cylinder-bore preset = 43.68%
// divergence) that 2% comfortably separates a real hollow shape from a
// convex one. This is used ONLY as a cheap skip for GLB/no-metadata shapes
// that are almost certainly convex — CSG shapes never use this, they
// trigger unconditionally on structural isHole data, since divergence can't
// be trusted in general (a large shape with a tiny real cavity can sit
// arbitrarily far under any fixed threshold — confirmed with the
// big-block/small-bore case at 0.17% divergence).
const GLB_CONVEXITY_SKIP_THRESHOLD = 0.005;

/**
 * True if a GLB mesh is concave enough to be worth voxelizing at all.
 * `indices` must be passed for indexed geometry (virtually all real glTF
 * exports): without it, meshVolume falls back to treating every 3
 * consecutive vertices in the (deduplicated, index-referenced) vertex
 * buffer as its own triangle, which is not the mesh's actual triangulation
 * and produces a meaningless "actual volume" — silently misclassifying
 * genuinely concave imports (e.g. gears, bracketed holes) as convex and
 * routing them to a hull collider that smooths right over the concavity.
 */
export function isGlbConcave(positions: Float32Array, indices?: Uint32Array | Uint16Array): boolean {
  const actual = meshVolume(positions, indices);
  if (actual <= 0) return false;
  const hull = convexHullVolume(positions);
  if (hull <= 0) return false;
  const divergence = 1 - actual / hull;
  return divergence > GLB_CONVEXITY_SKIP_THRESHOLD;
}
