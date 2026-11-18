import * as THREE from "three";
import type { CustomMember } from "../pages/CadStudio";
import { meshVolume } from "./hollowShapeVoxelization";

// Standalone geometric decomposer for the "primitive-history compound
// collider" plan's Tier 1 case: a solid cylinder with a concentric
// circular through-hole (a bore/collar/bushing) is sliced into N angular
// wedge hulls spanning [holeRadius, solidRadius] at each angle, rather
// than approximated by a voxel grid. NOT wired into any live collider
// path yet — see the plan doc for the follow-up wiring step.

export type CylinderParams = {
  radius: number;
  height: number;
  axis: 0 | 1 | 2; // the cylinder's long axis: 0=x, 1=y, 2=z
  center: [number, number, number];
};

// A solid/hole input can be described three ways: a native analytic
// primitive (exact, zero recognition error), or an arbitrary triangle mesh
// (a GLB-typed leaf, e.g. cylinder.glb) that has to be *recognized* as
// roughly cylindrical before it can be treated as one — see
// fitCylinderFromMesh. "box" is accepted as an explicit input variant
// specifically so decomposeConcentricBore can reject it predictably (see
// requirement 3 / BOX_SOLID_UNSUPPORTED below) rather than only being able
// to express "not a cylinder" via a mesh that happens to fail the fit.
export type PrimitiveDescriptor =
  | ({ kind: "cylinder" } & CylinderParams)
  | { kind: "box"; halfExtents: [number, number, number]; center: [number, number, number] }
  | { kind: "mesh"; positions: Float32Array; indices?: Uint32Array | Uint16Array };

export type WedgePiece = {
  // Convex hull vertex positions for one wedge, local space (same frame as
  // the input descriptors), consecutive [x, y, z] triples — ready to hand
  // to a ConvexHullCollider once this is wired in.
  positions: Float32Array;
};

export type ConcentricBoreResult = {
  pieces: WedgePiece[];
  // Parallel to pieces — each piece's own carved (post-subtraction)
  // volume, computed analytically from the annular-sector formula, not
  // estimated. Feeds mass-fraction calculation once wired in.
  volumes: number[];
};

export type CylinderFit = {
  params: CylinderParams;
  // 0 = the two non-axis bounding-box extents are identical (a true
  // circular cross-section reads as 0 here regardless of how well the
  // shape actually fills that cross-section — see volumeFillDeviation for
  // that half of the check).
  radialAspectDeviation: number;
  // 0 = the mesh's actual volume exactly matches an ideal cylinder's
  // (π·r²·h) built from its own bounding box. This is the check that
  // actually distinguishes a cylinder from e.g. a hexagonal prism, which
  // can have an equally square/symmetric bounding box (radialAspectDeviation
  // ≈ 0) but a visibly different fill ratio.
  volumeFillDeviation: number;
};

// Tolerances below are picked from real measurements, not guessed — see
// the instrumentation run (this session) against public/uploads/*.glb:
//
//   asset            radialAspectDeviation   volumeFillDeviation
//   cylinder.glb            0.0000                 0.0064   <- the real thing
//   hexagon.glb              0.0000                 0.0450   <- closest false-positive risk
//   cube/sphere/cone/
//   cogwheel/torus/gear      0.00–0.89               0.28–0.73
//
// radialAspectDeviation alone does not separate a hexagon from a true
// cylinder (a regular hexagon's bounding box can be exactly as square/
// symmetric as a cylinder's). volumeFillDeviation is the actual
// discriminator: real cylinder.glb measures 0.64%, the closest
// false-positive (hexagon) measures 4.5% — a 2% threshold sits with a 3x
// margin above the real asset and a 2.25x margin below the nearest
// false positive. radialAspectDeviation is kept as a first-pass filter
// with a looser tolerance (real-world mesh export noise), since it's cheap
// and catches grossly non-circular cases (e.g. the tested gear mesh, whose
// best-axis radialAspectDeviation is still 0 — it's an asymmetric part, so
// its OTHER axes score much worse, but the fill check is what actually
// rejects it: 27.7% on its best axis).
export const CYLINDER_RADIAL_ASPECT_TOLERANCE = 0.05;
export const CYLINDER_VOLUME_FILL_TOLERANCE = 0.02;

// How far off-axis (as a fraction of the solid's radius) the hole's center
// may sit and still count as "concentric". Not derived from asset
// measurement (unlike the two tolerances above) — this is a design choice
// about how forgiving the pattern-match should be for slightly-imprecise
// authoring, not a property of any real mesh. Revisit with real scene data
// once this is wired in and used on actual user-authored shapes.
export const CONCENTRICITY_TOLERANCE = 0.02;

// How short of the solid's full height the hole may fall and still count
// as a clean through-hole (not a blind/partial bore, which this v1
// deliberately does not attempt — see the height check in
// decomposeConcentricBore). Same "design choice, not measured" caveat as
// CONCENTRICITY_TOLERANCE.
export const THROUGH_HOLE_TOLERANCE = 0.02;

// Each wedge's outer edge is a straight chord between two points on the
// circle, not a true arc — so the collider's roundness is purely a
// function of wedge count, same tradeoff as any polygonal circle
// approximation. Raised from the plan's original 12-16 suggestion to 32
// for visibly smoother edges; still cheap in absolute terms (the box-voxel
// approach this replaces was emitting up to 350 pieces per shape). Larger-
// radius bores where faceting is more visually obvious can pass a higher
// wedgeCount per call — this is just the baseline.
export const DEFAULT_WEDGE_COUNT = 32;
// A wedge spanning 2π/N must stay under π to guarantee its 8 corner points
// form a convex hull (an annular sector wider than a half-turn is
// concave). N=3 is the hard floor; a caller-supplied wedgeCount is
// validated against it regardless of the default above.
const MIN_WEDGE_COUNT = 3;

// Exported so other decomposers working in the same axis-indexed local
// space (e.g. the boundary-following bore decomposer) share this instead
// of a second copy.
export function otherAxes(axis: 0 | 1 | 2): [0 | 1 | 2, 0 | 1 | 2] {
  if (axis === 0) return [1, 2];
  if (axis === 1) return [0, 2];
  return [0, 1];
}

/**
 * Attempts to recognize an arbitrary triangle mesh as "roughly a
 * cylinder": fits a bounding-box-derived cylinder against all 3 candidate
 * axes, scores each by how circular its cross-section reads
 * (radialAspectDeviation) and how closely its actual volume matches the
 * ideal cylinder volume for that fit (volumeFillDeviation), and returns
 * the best-scoring axis if it clears both tolerances. Returns null if no
 * axis is a good enough fit — this is the GLB-leaf half of "solid may be a
 * native cylinder/box CustomMember OR a GLB-typed leaf recognized as
 * roughly cylindrical".
 */
export function fitCylinderFromMesh(
  positions: Float32Array,
  indices?: Uint32Array | Uint16Array,
): CylinderFit | null {
  if (positions.length < 9) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const actualVolume = meshVolume(positions, indices);
  if (actualVolume <= 0) return null;

  let best: CylinderFit | null = null;
  // Axis 1 (Y) checked first so it wins ties (strict `<` below never
  // replaces an equal-scoring candidate) — matters for a cylinder whose
  // radius exactly equals half its height (e.g. the "pipe" preset's unit
  // solid, scale [1,1,1]: bounding box [1,1,1], a perfect cube), where all
  // 3 axis candidates score identically and the choice is otherwise
  // arbitrary from bounding-box data alone. Y is every native primitive's
  // base-geometry axis in this app (CylinderGeometry, ConeGeometry, etc.),
  // so this makes the tie-break consistent with that convention instead of
  // an accident of loop order. Found while validating the native-cylinder
  // fit-upsampling fix — the "pipe" case's solid hits this tie exactly.
  for (const axis of [1, 0, 2] as const) {
    const [a, b] = otherAxes(axis);
    const diamA = size[a], diamB = size[b], height = size[axis];
    if (diamA <= 0 || diamB <= 0 || height <= 0) continue;

    const radialAspectDeviation = Math.abs(diamA - diamB) / Math.max(diamA, diamB);
    const radius = (diamA + diamB) / 4; // average of the two half-diameters
    const idealVolume = Math.PI * radius * radius * height;
    const volumeFillDeviation = Math.abs(actualVolume - idealVolume) / idealVolume;

    const candidate: CylinderFit = {
      params: { radius, height, axis, center },
      radialAspectDeviation,
      volumeFillDeviation,
    };
    const candidateScore = candidate.radialAspectDeviation + candidate.volumeFillDeviation;
    const bestScore = best ? best.radialAspectDeviation + best.volumeFillDeviation : Infinity;
    if (candidateScore < bestScore) best = candidate;
  }

  if (!best) return null;
  if (best.radialAspectDeviation > CYLINDER_RADIAL_ASPECT_TOLERANCE) return null;
  if (best.volumeFillDeviation > CYLINDER_VOLUME_FILL_TOLERANCE) return null;
  return best;
}

/** Convenience wrapper for call sites that only need the yes/no answer. */
export function isRoughlyCylindrical(
  positions: Float32Array,
  indices?: Uint32Array | Uint16Array,
): boolean {
  return fitCylinderFromMesh(positions, indices) !== null;
}

// Exported so other decomposers can resolve a PrimitiveDescriptor (native
// analytic vs. GLB-leaf-needing-recognition) the same way, instead of
// re-implementing the "box always fails, cylinder passes through, mesh
// goes through fitCylinderFromMesh" dispatch a second time.
export function resolveCylinderParams(desc: PrimitiveDescriptor): CylinderParams | null {
  if (desc.kind === "box") return null;
  if (desc.kind === "cylinder") {
    return { radius: desc.radius, height: desc.height, axis: desc.axis, center: desc.center };
  }
  const fit = fitCylinderFromMesh(desc.positions, desc.indices);
  return fit ? fit.params : null;
}

// The app's shared render-geometry cache (getCachedGeometry's "medium"
// cylinder, used by every native "cylinder" CustomMember) uses 16 radial
// segments — fine for rendering, but a 16-segment inscribed polygon
// measures ~2.55% volumeFillDeviation against a true cylinder, a near-miss
// against CYLINDER_VOLUME_FILL_TOLERANCE (2%) purely from facet coarseness,
// not genuine non-cylindricality (see boreDecompositionSurvey.test.ts's
// "pipe" finding — the simplest possible bore/collar shape in the app was
// being silently rejected by this). Deliberately NOT fixed by raising the
// app-wide default segment count or loosening the tolerance — both have
// render-quality/perf and unrelated-recognition-behavior consequences well
// outside this decomposer's scope. Instead, native cylinder members are
// rebuilt at a higher, fixed resolution purely for recognition/
// decomposition math, via tryBuildUpsampledCylinderDescriptor below — the
// member's actual stored geometry, render mesh, and the shared cache are
// never touched.
//
// 32 was chosen from direct measurement, not guessed: volumeFillDeviation
// vs. segment count for a unit cylinder — 8: 9.97%, 16: 2.55%, 24: 1.14%,
// 32: 0.64%. 32 clears the 2% tolerance with a >3x margin, consistent with
// how DEFAULT_WEDGE_COUNT (32) was already chosen for visual smoothness —
// same number, different justification.
export const NATIVE_CYLINDER_FIT_SEGMENTS = 32;

/**
 * Rebuilds a native cylinder's geometry (a unit cylinder — radius 0.5,
 * height 1, axis Y, matching getCachedGeometry's own base geometry —
 * transformed by the given offset/rotation/scale, same compose order
 * evaluateCustomGeometry uses) at NATIVE_CYLINDER_FIT_SEGMENTS instead of
 * the app's shared 16-segment render cache. Pure geometry in, pure
 * PrimitiveDescriptor out — no CustomMember dependency, so it's equally
 * usable from a caller that already has raw offset/rotation/scale.
 */
export function buildNativeCylinderFitDescriptor(
  scale: [number, number, number],
  rotation: [number, number, number],
  offset: [number, number, number],
): PrimitiveDescriptor {
  const geom = new THREE.CylinderGeometry(0.5, 0.5, 1, NATIVE_CYLINDER_FIT_SEGMENTS);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...offset),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  geom.applyMatrix4(matrix);
  const positions = new Float32Array(geom.attributes.position.array);
  const indices = geom.index ? new Uint32Array(geom.index.array) : undefined;
  geom.dispose();
  return { kind: "mesh", positions, indices };
}

/**
 * The single sanctioned way to convert a native "cylinder" CustomMember
 * into a PrimitiveDescriptor for Tier 1a/1b recognition purposes — callers
 * building solid/hole descriptors from CustomMember data should try this
 * first and fall back to their existing mesh-building path (unaffected by
 * this fix) for everything else. Returns null for any member type other
 * than "cylinder" (per requirement: GLB-typed leaves keep using their
 * existing fitCylinderFromMesh-on-the-real-mesh path unaffected; box/
 * sphere/etc are never cylinders regardless of resolution).
 */
export function tryBuildUpsampledCylinderDescriptor(member: CustomMember): PrimitiveDescriptor | null {
  if (member.type !== "cylinder") return null;
  return buildNativeCylinderFitDescriptor(member.scale, member.rotation, member.offset);
}

function buildWedges(
  outerRadius: number,
  innerRadius: number,
  height: number,
  axis: 0 | 1 | 2,
  center: [number, number, number],
  wedgeCount: number,
): ConcentricBoreResult {
  const [axisA, axisB] = otherAxes(axis);
  const halfHeight = height / 2;
  const angleStep = (2 * Math.PI) / wedgeCount;

  const toVec = (radius: number, angle: number, axialOffset: number): [number, number, number] => {
    const v: [number, number, number] = [0, 0, 0];
    v[axisA] = center[axisA] + radius * Math.cos(angle);
    v[axisB] = center[axisB] + radius * Math.sin(angle);
    v[axis] = center[axis] + axialOffset;
    return v;
  };

  const pieces: WedgePiece[] = [];
  const volumes: number[] = [];
  // Annular-sector area × height — exact for the piece we're actually
  // emitting (a wedge already carved to [innerRadius, outerRadius]), not
  // an estimate of the uncut primitive.
  const sectorArea = 0.5 * angleStep * (outerRadius * outerRadius - innerRadius * innerRadius);
  const wedgeVolume = sectorArea * height;

  for (let i = 0; i < wedgeCount; i++) {
    const a0 = i * angleStep;
    const a1 = (i + 1) * angleStep;
    const corners2D: Array<[number, number]> = [
      [innerRadius, a0],
      [outerRadius, a0],
      [outerRadius, a1],
      [innerRadius, a1],
    ];
    const verts: number[] = [];
    for (const axialOffset of [-halfHeight, halfHeight]) {
      for (const [r, a] of corners2D) {
        const p = toVec(r, a, axialOffset);
        verts.push(p[0], p[1], p[2]);
      }
    }
    pieces.push({ positions: new Float32Array(verts) });
    volumes.push(wedgeVolume);
  }

  return { pieces, volumes };
}

/**
 * Decomposes a solid-minus-concentric-circular-hole pair into N convex
 * wedge hulls, in local unscaled space. Returns null (never a partial or
 * best-effort result) for anything outside the recognized pattern, so
 * callers can fall back to the existing voxel-box compound collider
 * unconditionally on a null return — see the plan doc's Tier 1/Tier 2
 * split.
 *
 * Deliberately out of scope for v1 (documented here so it's easy to find
 * when/if revisited):
 *   - A box solid with a circular bore. Unlike a cylindrical solid (whose
 *     outer boundary is the same radius at every angle, making the wedge
 *     math trivial), a box's outer boundary varies with angle — the wedge
 *     for a corner direction needs to reach the box's corner, not just its
 *     face. That's a real per-angle boundary computation, not a constant,
 *     and isn't attempted here. Always returns null for `solid.kind ===
 *     "box"`.
 *   - Blind/partial-depth holes (hole shorter than the solid). Only a
 *     clean through-hole (hole height within THROUGH_HOLE_TOLERANCE of the
 *     solid's height) is handled.
 *   - Non-uniform scale on the radial axes. This function assumes it's
 *     already being called in a frame where that's been ruled out by the
 *     caller (per the plan: "non-uniform scale on radial axes is out of
 *     scope here and should return null, not attempt a fix") — it has no
 *     scale parameter to apply, so a caller must resolve that before
 *     calling in, or equivalently just not call in for such a shape.
 */
export function decomposeConcentricBore(
  solid: PrimitiveDescriptor,
  hole: PrimitiveDescriptor,
  wedgeCount: number = DEFAULT_WEDGE_COUNT,
): ConcentricBoreResult | null {
  if (wedgeCount < MIN_WEDGE_COUNT) return null;

  // Box solid + circular bore: out of scope for v1, see doc comment above.
  if (solid.kind === "box") return null;

  const solidParams = resolveCylinderParams(solid);
  if (!solidParams) return null;
  const holeParams = resolveCylinderParams(hole);
  if (!holeParams) return null;

  // Off-axis: the hole's own long axis doesn't match the solid's.
  if (solidParams.axis !== holeParams.axis) return null;

  // Non-concentric: the hole's center is displaced from the solid's axis
  // in the radial plane by more than the tolerance.
  const [a, b] = otherAxes(solidParams.axis);
  const radialOffset = Math.hypot(
    holeParams.center[a] - solidParams.center[a],
    holeParams.center[b] - solidParams.center[b],
  );
  if (radialOffset > CONCENTRICITY_TOLERANCE * solidParams.radius) return null;

  // Degenerate/invalid radius relationship.
  if (holeParams.radius <= 0 || holeParams.radius >= solidParams.radius) return null;

  // Not a clean through-hole.
  if (holeParams.height < solidParams.height * (1 - THROUGH_HOLE_TOLERANCE)) return null;

  // ...and not merely long enough, but actually SPANNING the solid. Only the
  // heights were ever compared, so a correctly-sized hole slid almost entirely
  // off one end was accepted and decomposed into a clean centred through-bore
  // — carving the bore where there isn't one. The hole must reach past both
  // faces of the solid to count. See BUG-025.
  const axis = solidParams.axis;
  const solidMin = solidParams.center[axis] - solidParams.height / 2;
  const solidMax = solidParams.center[axis] + solidParams.height / 2;
  const holeMin = holeParams.center[axis] - holeParams.height / 2;
  const holeMax = holeParams.center[axis] + holeParams.height / 2;
  const slack = solidParams.height * THROUGH_HOLE_TOLERANCE;
  if (holeMin > solidMin + slack || holeMax < solidMax - slack) return null;

  return buildWedges(
    solidParams.radius,
    holeParams.radius,
    solidParams.height,
    solidParams.axis,
    solidParams.center,
    wedgeCount,
  );
}
