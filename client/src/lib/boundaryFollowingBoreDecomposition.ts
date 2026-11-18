import * as THREE from "three";
import type { Evaluator } from "three-bvh-csg";
import { MeshBVH } from "three-mesh-bvh";
import type { CustomMember } from "../pages/CadStudio";
import { evaluateCustomGeometry } from "../components/canvas/utils/geometryHelpers";
import {
  resolveCylinderParams,
  otherAxes,
  CONCENTRICITY_TOLERANCE,
  THROUGH_HOLE_TOLERANCE,
  type PrimitiveDescriptor,
  type WedgePiece,
} from "./concentricBoreDecomposition";

// Tier 1b of the primitive-history collider plan: decomposeConcentricBore
// (Tier 1a) only works when the SOLID is itself recognized as a cylinder.
// Real shapes built via addition (multiple primitives unioned — a collar
// welded to a gear) or with a non-circular outer silhouette (gear teeth, a
// box) fail that recognition and fall to Tier 2 (voxel-box) today, which
// is where the "not as smooth" roughness comes from. This module handles
// that broader case: the HOLE must still be a recognized concentric
// circular bore (a circular hole genuinely is a circle, no tracing
// needed), but the SOLID's outer boundary is sampled directly from its
// real merged mesh via radial raycasting instead of assumed to be a
// constant radius.
//
// NOT wired into any live collider path — isolated implementation +
// testing only, same status as decomposeConcentricBore.
//
// This module deliberately uses `MeshBVH` directly instead of the
// computeBoundsTree/acceleratedRaycast prototype patches that voxelCollider.ts
// applies. Those patches are global: they replace THREE.Mesh.prototype.raycast
// for every mesh in the process, which voxelCollider.ts can justify only
// because it runs exclusively inside a dedicated Web Worker. This module has no
// such guarantee — it runs wherever it is imported, main thread included — and
// patching there would change raycast behaviour for react-three-fiber's own
// pointer picking. Calling the BVH API directly removes the question entirely,
// so wiring this in needs no decision about global patching. See BUG-027.

export type BoundaryFollowingBoreResult = {
  pieces: WedgePiece[];
  volumes: number[];
  // Wall-clock time for the raycast+integration pass (module build +
  // sampling + subdivision), excluding CSG evaluation of the addition-only
  // merge — reported so a future caller can decide whether this shape was
  // cheap enough, and so the 50ms budget in this module's validation can
  // be checked against real data instead of assumed.
  raycastMs: number;
};

// Base angular resolution before adaptive refinement — matches the "start
// at N=16" instruction. Distinct from concentricBoreDecomposition's
// DEFAULT_WEDGE_COUNT (32): that constant is the FINAL wedge count for a
// case that never needs subdivision (constant-radius solid); this is a
// STARTING point that grows via refinement for a boundary that isn't flat.
const DEFAULT_BASE_ANGLE_SAMPLES = 16;

// A segment gets bisected if the outer-radius delta between its two
// current endpoint samples exceeds this fraction of the smaller of the
// two — i.e. "adjacent angle samples" per the spec, evaluated at whatever
// refinement level a segment is currently at (not just the original base
// samples). 3% per the task's instruction — MEASURED FINDING (see this
// module's test file and its accompanying summary): a real gear's teeth
// need ~152 pieces / ~138ms to satisfy this tolerance, well past the 50ms
// budget below, so at these defaults a toothed shape correctly returns
// null (falls back to Tier 2) rather than either erroring or silently
// blowing the time budget. 3% works well for smooth/faceted-but-gentle
// boundaries (validated to <0.1% against Tier 1a on a cylinder, ~tenths
// of a percent on the box/union cases) — it just isn't a fit for sharp
// tooth-scale detail at a piece/time budget suitable for live use, and
// this module deliberately does NOT loosen it to force gear-shaped inputs
// to succeed, since 3%'s job is bounding wedge-chord error, not sizing the
// budget for how "spiky" a particular test asset happens to be.
const DEFAULT_CURVATURE_DELTA_TOLERANCE = 0.03;

// Bounds worst-case pieces contributed by a single base segment to
// 2^maxSubdivisionDepth. Combined with baseAngleSamples this bounds the
// absolute worst case to baseAngleSamples * 2^maxSubdivisionDepth, though
// maxTotalPieces is the tighter, actually-enforced ceiling below.
const DEFAULT_MAX_SUBDIVISION_DEPTH = 5;

// Placeholder budget in the same spirit as voxelCollider.ts's
// MAX_FINAL_BOXES — no shared MAX_PRIMITIVE_COLLIDERS constant exists yet
// anywhere in the codebase (it was proposed in the planning doc but never
// implemented, since primitive-history colliders aren't wired in). This is
// a local stand-in, not a reuse of something that already exists; revisit
// once there's a real shared budget to defer to. 128 was chosen, then
// verified empirically (not just asserted) to correctly reject the gear
// case rather than accept an over-budget result — see DEFAULT_
// CURVATURE_DELTA_TOLERANCE's comment for the measured numbers.
const DEFAULT_MAX_TOTAL_PIECES = 128;

/** Tunable knobs, mainly for diagnostics/tests — see decomposeBoundaryFollowingBore's
 * own doc comment for what each default means and why. */
export type BoundaryFollowingBoreConfig = {
  baseAngleSamples?: number;
  curvatureDeltaTolerance?: number;
  maxSubdivisionDepth?: number;
  maxTotalPieces?: number;
};

// Small fractional offset past the hole's radius to guarantee the raycast
// origin starts inside solid material, not exactly on the hole boundary
// (where floating-point noise could put it on either side).
const RADIAL_START_EPSILON_FACTOR = 1e-4;

/**
 * Casts a ray outward from a point just past the hole boundary (already
 * inside solid material by construction) at a given angle/height, and
 * returns the absolute radius (from the axis) of the first surface it
 * hits — the true outer boundary at that angle. Returns null if the ray
 * misses the mesh entirely (open/non-manifold geometry, or a genuinely
 * malformed input) — callers treat that as "can't confidently handle this
 * shape", not a zero-radius result.
 *
 * DoubleSide for the same reason voxelCollider.ts's makeInsideTest needs it: a
 * ray starting inside a closed mesh only ever sees the back side of
 * front-facing triangles on its way out, and FrontSide would cull every one.
 */

/**
 * Casts a ray outward from a point just past the hole boundary (already
 * inside solid material by construction) at a given angle/height, and
 * returns the absolute radius (from the axis) of the first surface it
 * hits — the true outer boundary at that angle. Returns null if the ray
 * misses the mesh entirely (open/non-manifold geometry, or a genuinely
 * malformed input) — callers treat that as "can't confidently handle this
 * shape", not a zero-radius result.
 */
function sampleOuterRadius(
  bvh: MeshBVH,
  axis: 0 | 1 | 2,
  center: [number, number, number],
  axialSampleCoord: number,
  holeRadius: number,
  maxDistance: number,
  angle: number,
): number | null {
  const [axisA, axisB] = otherAxes(axis);
  const startRadius = holeRadius * (1 + RADIAL_START_EPSILON_FACTOR);

  const origin = new THREE.Vector3();
  origin.setComponent(axisA, center[axisA] + startRadius * Math.cos(angle));
  origin.setComponent(axisB, center[axisB] + startRadius * Math.sin(angle));
  origin.setComponent(axis, axialSampleCoord);

  const direction = new THREE.Vector3();
  direction.setComponent(axisA, Math.cos(angle));
  direction.setComponent(axisB, Math.sin(angle));
  direction.setComponent(axis, 0);

  // raycastFirst, not a full raycast + sort: only the nearest hit is ever
  // read, and the BVH can stop at it.
  const hit = bvh.raycastFirst(
    new THREE.Ray(origin, direction),
    THREE.DoubleSide,
    0,
    maxDistance,
  );
  if (!hit) return null;
  return startRadius + hit.distance;
}

/**
 * Exact area (shoelace formula) of the quadrilateral this function's
 * caller is about to emit as a wedge's cross-section — NOT an idealized
 * annular-sector formula. Emitted hull geometry uses a straight chord
 * between (r0, a0) and (r1, a1) on the outer edge (see buildWedgeHullVerts
 * doc comment for why), so the volume assigned to that exact piece must
 * match that exact shape, not a curve it doesn't actually have.
 */
function quadCrossSectionArea(
  holeRadius: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): number {
  const p0x = holeRadius * Math.cos(a0), p0y = holeRadius * Math.sin(a0);
  const p1x = r0 * Math.cos(a0), p1y = r0 * Math.sin(a0);
  const p2x = r1 * Math.cos(a1), p2y = r1 * Math.sin(a1);
  const p3x = holeRadius * Math.cos(a1), p3y = holeRadius * Math.sin(a1);
  const shoelace =
    p0x * (p1y - p3y) + p1x * (p2y - p0y) + p2x * (p3y - p1y) + p3x * (p0y - p2y);
  return Math.abs(shoelace) / 2;
}

/**
 * Vertex positions for one wedge's convex hull: a chord between (r0, a0)
 * and (r1, a1) on the outer edge, extruded along the axis. Deliberately
 * NOT curved (no third outer point at the segment's sampled midpoint
 * radius) — a 3rd outer point would require re-triangulating a non-planar
 * quad face, and the adaptive-subdivision pass already bounds how far this
 * chord can diverge from the true boundary (same CURVATURE_DELTA_TOLERANCE
 * used to decide whether to subdivide further). The volume assigned to
 * this piece (see decomposeBoundaryFollowingBore) is intentionally NOT
 * this chord-quad's own area, though — see that function's doc comment.
 */
function buildWedgeHullVerts(
  axis: 0 | 1 | 2,
  center: [number, number, number],
  holeRadius: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  height: number,
): Float32Array {
  const [axisA, axisB] = otherAxes(axis);
  const halfHeight = height / 2;

  const toVec = (radius: number, angle: number, axialOffset: number): [number, number, number] => {
    const v: [number, number, number] = [0, 0, 0];
    v[axisA] = center[axisA] + radius * Math.cos(angle);
    v[axisB] = center[axisB] + radius * Math.sin(angle);
    v[axis] = center[axis] + axialOffset;
    return v;
  };

  const corners: Array<[number, number]> = [
    [holeRadius, a0],
    [r0, a0],
    [r1, a1],
    [holeRadius, a1],
  ];
  const verts: number[] = [];
  for (const axialOffset of [-halfHeight, halfHeight]) {
    for (const [r, a] of corners) {
      const p = toVec(r, a, axialOffset);
      verts.push(p[0], p[1], p[2]);
    }
  }
  return new Float32Array(verts);
}

type SampleFn = (angle: number) => number | null;

/**
 * Recursively resolves one angular segment [a0, a1] with known endpoint
 * radii (r0, r1): samples the segment's midpoint, and either subdivides
 * (if the midpoint diverges from the endpoints by more than
 * CURVATURE_DELTA_TOLERANCE, i.e. "adjacent angle samples" per the spec —
 * evaluated at whatever refinement level this call is currently at, not
 * just the original base samples) or emits exactly one wedge.
 *
 * Volume for the emitted wedge uses Simpson's rule (3-point quadrature:
 * r0, rmid, r1) over the annular-sector area function, NOT the emitted
 * chord-quad's own (smaller, for an outward-curving boundary) shoelace
 * area. This is a deliberate choice, not an oversight: the emitted hull is
 * a simplified, always-convex COLLIDER shape, but the actual solid
 * material it's standing in for follows the true (possibly curved/
 * faceted) boundary the raycasts are sampling — Simpson's rule, using the
 * midpoint sample already taken for the subdivision decision (so it costs
 * no extra raycasts), estimates that TRUE volume more accurately than the
 * simplified hull's own smaller area would. This mirrors a common physics-
 * engine pattern of a simplified collision shape paired with a separately
 * (more accurately) computed mass. Simpson over plain trapezoidal because
 * it's exact for up to cubic radius variation vs. trapezoidal's linear-
 * only, at zero extra raycast cost given the midpoint sample already
 * exists.
 */
type ResolvedConfig = {
  baseAngleSamples: number;
  curvatureDeltaTolerance: number;
  maxSubdivisionDepth: number;
  maxTotalPieces: number;
};

function subdivideAndIntegrate(
  sample: SampleFn,
  axis: 0 | 1 | 2,
  center: [number, number, number],
  holeRadius: number,
  height: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  depth: number,
  outPieces: WedgePiece[],
  outVolumes: number[],
  config: ResolvedConfig,
): boolean {
  if (outPieces.length >= config.maxTotalPieces) return false;

  const amid = (a0 + a1) / 2;
  const rmid = sample(amid);
  if (rmid === null) return false;

  const localRadius = Math.min(r0, r1, rmid);
  if (localRadius <= 0) return false;
  const delta0 = Math.abs(rmid - r0) / localRadius;
  const delta1 = Math.abs(r1 - rmid) / localRadius;
  const needsSplit =
    (delta0 > config.curvatureDeltaTolerance || delta1 > config.curvatureDeltaTolerance) &&
    depth < config.maxSubdivisionDepth;

  if (needsSplit) {
    if (!subdivideAndIntegrate(sample, axis, center, holeRadius, height, a0, amid, r0, rmid, depth + 1, outPieces, outVolumes, config)) {
      return false;
    }
    return subdivideAndIntegrate(sample, axis, center, holeRadius, height, amid, a1, rmid, r1, depth + 1, outPieces, outVolumes, config);
  }

  const f = (r: number) => 0.5 * (r * r - holeRadius * holeRadius);
  const volume = (height * (a1 - a0) / 6) * (f(r0) + 4 * f(rmid) + f(r1));
  if (!(volume > 0)) return false; // no degenerate/zero/negative pieces, ever

  const positions = buildWedgeHullVerts(axis, center, holeRadius, a0, a1, r0, r1, height);
  outPieces.push({ positions });
  outVolumes.push(volume);
  // (A post-push `length > maxTotalPieces` check used to sit here. It was
  // unreachable: the guard at the top of this function already returns when
  // length >= max, so after one push length can be at most max. Removed rather
  // than left looking like a live ceiling. See BUG-028.)
  return true;
}

/**
 * Tier 1b of the primitive-history plan: decomposes a solid built from an
 * addition-only union of `solidMembers` (any recognized cylinder-fit not
 * required — this is the whole point, unlike decomposeConcentricBore) with
 * a single concentric circular through-hole into convex wedge pieces whose
 * outer boundary follows the solid's REAL merged geometry, sampled via
 * radial raycasting rather than assumed constant.
 *
 * Returns null (never a partial/best-effort result) for: more than one
 * isHole-flagged member present in solidMembers (only a single externally-
 * supplied hole is handled), a hole that isn't itself recognized as
 * circular (native cylinder or GLB fit — see
 * concentricBoreDecomposition.ts), an off-axis or non-concentric hole, a
 * blind (non-through) hole, or a piece-count budget overrun. Callers
 * should fall through to the existing voxel-box compound collider on any
 * null return, same as decomposeConcentricBore's contract.
 *
 * CACHING CONTRACT (not implemented here, since this is a pure function —
 * documented for whoever wires this in): this function is deterministic
 * given (solidMembers, hole, evaluator, gltfGeometryMap, config) and does
 * its own internal timing (`raycastMs`) specifically so a caller can judge
 * whether a result was cheap enough, but it does NOT cache anything
 * itself. It MUST be memoized by the caller the same way
 * evaluateCustomGeometry's own results already are elsewhere (a useMemo
 * keyed on a serialized-members signature, matching the `cacheKey` pattern
 * hollowShapeVoxelization.ts already uses) — never called fresh per render
 * or per physics step. This function does one CSG addition-only merge plus
 * up to maxTotalPieces raycasts per call; at 60fps that's not a per-frame-
 * safe cost (measured up to ~138ms on a detailed real asset — see this
 * module's test file).
 */
export function decomposeBoundaryFollowingBore(
  solidMembers: CustomMember[],
  hole: PrimitiveDescriptor,
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  config?: BoundaryFollowingBoreConfig,
): BoundaryFollowingBoreResult | null {
  const start = performance.now();
  const resolved: ResolvedConfig = {
    baseAngleSamples: config?.baseAngleSamples ?? DEFAULT_BASE_ANGLE_SAMPLES,
    curvatureDeltaTolerance: config?.curvatureDeltaTolerance ?? DEFAULT_CURVATURE_DELTA_TOLERANCE,
    maxSubdivisionDepth: config?.maxSubdivisionDepth ?? DEFAULT_MAX_SUBDIVISION_DEPTH,
    maxTotalPieces: config?.maxTotalPieces ?? DEFAULT_MAX_TOTAL_PIECES,
  };

  // Only a single, externally-supplied hole is handled — if solidMembers
  // itself still carries more than one isHole entry, this pattern isn't
  // recognized (Tier 2 territory).
  const strayHoleCount = solidMembers.filter((m) => m.isHole).length;
  if (strayHoleCount > 1) return null;

  const holeParams = resolveCylinderParams(hole);
  if (!holeParams) return null; // non-circular hole

  const solids = solidMembers.filter((m) => !m.isHole);
  if (solids.length === 0) return null;

  const mergedGeom = evaluateCustomGeometry(solids, evaluator, gltfGeometryMap, undefined, true);
  mergedGeom.computeBoundingBox();
  const bbox = mergedGeom.boundingBox;
  if (!bbox || bbox.isEmpty()) {
    mergedGeom.dispose();
    return null;
  }

  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);
  const bboxCenter = new THREE.Vector3();
  bbox.getCenter(bboxCenter);

  const [axisA, axisB] = otherAxes(holeParams.axis);
  const estimatedSolidRadius =
    Math.max(bboxSize.getComponent(axisA), bboxSize.getComponent(axisB)) / 2;
  if (!(estimatedSolidRadius > 0)) {
    mergedGeom.dispose();
    return null;
  }

  // Off-axis / non-concentric: the hole's radial position vs. the solid's
  // own bounding-box center, in the plane perpendicular to the hole axis.
  const radialOffset = Math.hypot(
    holeParams.center[axisA] - bboxCenter.getComponent(axisA),
    holeParams.center[axisB] - bboxCenter.getComponent(axisB),
  );
  if (radialOffset > CONCENTRICITY_TOLERANCE * estimatedSolidRadius) {
    mergedGeom.dispose();
    return null;
  }

  if (holeParams.radius <= 0 || holeParams.radius >= estimatedSolidRadius) {
    mergedGeom.dispose();
    return null;
  }

  // Blind hole: the solid's own real extent along the hole's axis, not a
  // recognized-cylinder param (there may not be one) — measured from the
  // merged mesh's actual bounding box.
  const solidHeightAlongAxis = bboxSize.getComponent(holeParams.axis);
  if (holeParams.height < solidHeightAlongAxis * (1 - THROUGH_HOLE_TOLERANCE)) {
    mergedGeom.dispose();
    return null;
  }

  const positions = new Float32Array(mergedGeom.attributes.position.array);
  let indices: Uint32Array;
  if (mergedGeom.index) {
    indices = new Uint32Array(mergedGeom.index.array);
  } else {
    indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  mergedGeom.dispose();

  const raycastGeom = new THREE.BufferGeometry();
  raycastGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  raycastGeom.setIndex(new THREE.BufferAttribute(indices, 1));
  const bvh = new MeshBVH(raycastGeom);

  // The wedges are extruded over the SOLID's real extent along the bore axis,
  // not the hole's. Tier 1a already used the solid's height and centre; this
  // module used the hole's, and hole cutters are conventionally oversized
  // (CSGGroup even scales them by 1.01) while the through-hole check only ever
  // rejected holes that were too SHORT. So the pieces ran past the real
  // material at both ends and the Simpson volume over-counted to match.
  // See BUG-024.
  const extrusionHeight = solidHeightAlongAxis;
  const extrusionCenter: [number, number, number] = [...holeParams.center];
  extrusionCenter[holeParams.axis] = bboxCenter.getComponent(holeParams.axis);

  const maxDistance = bboxSize.length() + estimatedSolidRadius; // generous far plane
  // Sample at the solid's mid-height rather than the hole's, for the same
  // reason — an oversized cutter's centre can sit outside the material.
  const axialSampleCoord = extrusionCenter[holeParams.axis];

  const sample: SampleFn = (angle) =>
    sampleOuterRadius(bvh, holeParams.axis, holeParams.center, axialSampleCoord, holeParams.radius, maxDistance, angle);

  // Every exit path below must release the raycast geometry. It was previously
  // leaked on all of them, and the BVH was disposed BEFORE the refinement loop
  // ran — which silently dropped every refinement raycast back to brute force,
  // the exact cliff voxelCollider.ts documents. Holding it until the end and
  // releasing once in `finally` fixes both. See BUG-026.
  try {
    const baseAngles: number[] = [];
    for (let i = 0; i <= resolved.baseAngleSamples; i++) {
      baseAngles.push((i / resolved.baseAngleSamples) * 2 * Math.PI);
    }
    const baseRadii: Array<number | null> = baseAngles.map(sample);
    if (baseRadii.some((r) => r === null)) return null;

    const pieces: WedgePiece[] = [];
    const volumes: number[] = [];
    let ok = true;
    for (let i = 0; i < resolved.baseAngleSamples && ok; i++) {
      ok = subdivideAndIntegrate(
        sample,
        holeParams.axis,
        extrusionCenter,
        holeParams.radius,
        extrusionHeight,
        baseAngles[i],
        baseAngles[i + 1],
        baseRadii[i]!,
        baseRadii[i + 1]!,
        0,
        pieces,
        volumes,
        resolved,
      );
    }

    const raycastMs = performance.now() - start;
    if (!ok || pieces.length === 0) return null;
    return { pieces, volumes, raycastMs };
  } finally {
    raycastGeom.dispose();
  }
}
