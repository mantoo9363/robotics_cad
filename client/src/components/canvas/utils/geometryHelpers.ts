import * as THREE from "three";
import { Evaluator, ADDITION, SUBTRACTION, Brush } from "three-bvh-csg";
import type { CustomMember, ShapeType } from "../../../App";
import {
  toCreasedNormals,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getCachedGeometry } from "../../../lib/geometryCache";

// Shared dimensions for every cogwheel-*t variant — only tooth count differs
// between them. Exported so the physics collider builder can derive exact
// wedge colliders from the same numbers instead of a second hand-copied set
// that can drift out of sync (this is exactly how the collider ended up
// silently rendering as a sphere before: a second geometry recipe missing
// the cogwheel case entirely).
export const COGWHEEL_INNER_RADIUS = 0.35; // tooth root / outer edge of the base ring
export const COGWHEEL_OUTER_RADIUS = 0.5; // tooth tip
export const COGWHEEL_BORE_RADIUS = 0.15; // center axle hole — must stay empty
export const COGWHEEL_DEPTH = 0.2; // extrusion thickness (world Y after rotateX below)
// The extrude bevel, exported because the collider builder has to account for
// it: the rendered gear is thicker than COGWHEEL_DEPTH by 2x the thickness and
// wider than COGWHEEL_OUTER_RADIUS by the size. See BUG-021.
export const COGWHEEL_BEVEL_SIZE = 0.015;
export const COGWHEEL_BEVEL_THICKNESS = 0.015;

/**
 * The 4 corner points (in the gear's local XY shape-plane, pre-extrusion)
 * of a single tooth: root-start, tip-start, tip-end, root-end. A single
 * tooth's cross-section is convex on its own, so these 4 points are enough
 * to build an exact (not approximated) collider for it.
 */
export function getCogwheelToothProfile(teeth: number, toothIndex: number) {
  const angleStep = (2 * Math.PI) / teeth;
  const baseAngle = toothIndex * angleStep;
  const a0 = baseAngle;
  const a1 = baseAngle + angleStep * 0.25;
  const a2 = baseAngle + angleStep * 0.55;
  const a3 = baseAngle + angleStep * 0.8;
  return {
    x0: Math.cos(a0) * COGWHEEL_INNER_RADIUS,
    y0: Math.sin(a0) * COGWHEEL_INNER_RADIUS,
    x1: Math.cos(a1) * COGWHEEL_OUTER_RADIUS,
    y1: Math.sin(a1) * COGWHEEL_OUTER_RADIUS,
    x2: Math.cos(a2) * COGWHEEL_OUTER_RADIUS,
    y2: Math.sin(a2) * COGWHEEL_OUTER_RADIUS,
    x3: Math.cos(a3) * COGWHEEL_INNER_RADIUS,
    y3: Math.sin(a3) * COGWHEEL_INNER_RADIUS,
  };
}

function createCogWheelGeometry(
  teeth = 8,
  innerRadius = COGWHEEL_INNER_RADIUS,
  outerRadius = COGWHEEL_OUTER_RADIUS,
  depth = COGWHEEL_DEPTH,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const angleStep = (2 * Math.PI) / teeth;

  for (let i = 0; i < teeth; i++) {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = getCogwheelToothProfile(teeth, i);

    if (i === 0) {
      shape.moveTo(x0, y0);
    } else {
      shape.lineTo(x0, y0);
    }
    shape.lineTo(x1, y1);
    shape.lineTo(x2, y2);
    shape.lineTo(x3, y3);
  }

  shape.closePath();

  const holePath = new THREE.Path();
  holePath.absarc(0, 0, COGWHEEL_BORE_RADIUS, 0, Math.PI * 2, true);
  shape.holes.push(holePath);

  const extrudeSettings = {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.015,
    bevelThickness: 0.015,
  };

  const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geom.center();
  geom.rotateX(Math.PI / 2);
  return geom;
}

const cogWheelGeometryCache = new Map<number, THREE.BufferGeometry>();
export function getCogWheelGeometry(teeth?: number): THREE.BufferGeometry {
  const t = teeth || 8;
  let cached = cogWheelGeometryCache.get(t);
  if (!cached) {
    cached = createCogWheelGeometry(t);
    cogWheelGeometryCache.set(t, cached);
  }
  return cached.clone();
}

export function makeBasicGeom(type: string): THREE.BufferGeometry {
  // Straight to getCachedGeometry — getBasicGeom was a deprecated alias kept
  // only so callers shared one source of truth after it had drifted out of
  // sync (it was missing every cogwheel case and silently fell back to a
  // sphere). Nothing needs the indirection now. See BUG-052.
  return getCachedGeometry(type, "medium").clone();
}

export function applyVertexColor(geom: THREE.BufferGeometry, colorStr: string) {
  if (geom.attributes.color) return;
  const color = new THREE.Color(colorStr || "#ffffff");
  const posAttr = geom.attributes.position;
  if (!posAttr) return;
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// three-bvh-csg's Evaluator requires every brush geometry to carry every
// attribute named in evaluator.attributes — it reads referenceGeometry's
// attribute unconditionally when priming the fold (Evaluator.js's
// prepareAttributesData), so a brush missing one throws rather than being
// treated as "no data". All of this app's own primitive/cogwheel geometry
// carries "uv" already (three's built-in geometries always do), but an
// imported GLB is not guaranteed to — this is the same missing-attribute
// problem applyVertexColor solves for "color", for "uv" instead. A zero-fill
// is a deliberately minimal fallback (matching applyVertexColor's own
// flat-fill, not a real projection): it exists so texture mapping degrades
// to "one flat texel" on a UV-less import rather than crashing the fold.
export function applyDefaultUV(geom: THREE.BufferGeometry) {
  if (geom.attributes.uv) return;
  const posAttr = geom.attributes.position;
  if (!posAttr) return;
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(posAttr.count * 2), 2));
}

export interface EvaluateCustomGeometryResult {
  geometry: THREE.BufferGeometry;
  /** The Brush after the boolean fold but before crease/merge.
   * Returned only when `returnPreCreaseBrush` is true. */
  preCreaseBrush?: Brush;
}

// Overload 1: default behavior (backward compatible) - returns BufferGeometry
export function evaluateCustomGeometry(
  members: CustomMember[],
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  fallbackColor?: string,
  additionOnly?: boolean,
  path?: Set<CustomMember>,
  returnPreCreaseBrush?: false,
): THREE.BufferGeometry;

// Overload 2: with returnPreCreaseBrush=true - returns result object
export function evaluateCustomGeometry(
  members: CustomMember[],
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  fallbackColor?: string,
  additionOnly?: boolean,
  path?: Set<CustomMember>,
  returnPreCreaseBrush?: true,
): EvaluateCustomGeometryResult;

// Implementation
export function evaluateCustomGeometry(
  members: CustomMember[],
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  fallbackColor?: string,
  additionOnly: boolean = false,
  path: Set<CustomMember> = new Set(),
  returnPreCreaseBrush: boolean = false,
): THREE.BufferGeometry | EvaluateCustomGeometryResult {
  const solids = members.filter((m) => !m.isHole);
  const holes = additionOnly ? [] : members.filter((m) => m.isHole);

  const getMemberGeometry = (m: CustomMember): THREE.BufferGeometry => {
    let geom: THREE.BufferGeometry;
    if (m.type === "custom" && m.customMembers && path.has(m)) {
      // Cyclic branch. Substitute the plain primitive box rather than
      // recursing (stack overflow) or returning nothing (the member would
      // vanish from the CSG result with no trace). This mirrors the
      // solids.length === 0 fallback further down.
      console.warn(
        "[evaluateCustomGeometry] cyclic customMembers detected — substituting a " +
          "placeholder box for this member. The shape's saved structure is malformed.",
      );
      geom = makeBasicGeom("cube");
    } else if (m.type === "custom" && m.customMembers) {
      path.add(m);
      geom = evaluateCustomGeometry(
        m.customMembers,
        evaluator,
        gltfGeometryMap,
        m.color || fallbackColor,
        false,
        path,
      );
      path.delete(m);
    } else if (m.type === "glb" && m.url && gltfGeometryMap?.has(m.url)) {
      geom = gltfGeometryMap.get(m.url)!.clone();
    } else {
      geom = makeBasicGeom(m.type);
    }

    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...m.offset),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...m.rotation)),
      new THREE.Vector3(m.scale[0], m.scale[1], m.scale[2])
    );
    geom.applyMatrix4(matrix);
    geom.computeVertexNormals();

    // Only apply vertex color if the geometry doesn't already have color attributes
    // This preserves existing texture/material information
    if (!geom.attributes.color) {
      applyVertexColor(geom, m.color || fallbackColor || "#ffffff");
    }
    applyDefaultUV(geom);

    return geom;
  };

  if (solids.length === 0) {
    return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  const solidBrushes = solids.map((m) => {
    const geom = getMemberGeometry(m);
    const b = new Brush(geom);
    b.updateMatrixWorld();
    return b;
  });

  const holeBrushes = holes.map((m) => {
    const geom = getMemberGeometry(m);
    const b = new Brush(geom);
    b.updateMatrixWorld();
    return b;
  });

  // Every geometry superseded along the way is collected here and disposed
  // once the final result exists. Previously none of them were: each ADDITION
  // and SUBTRACTION allocates a new geometry, the retry below discards a whole
  // extra one, and toCreasedNormals replaces the last — all leaked, on every
  // re-evaluation, scaling with member count. CSGGroup already solved this
  // with the same staleGeometries set; this function, which sits on the
  // render path AND the voxelization path AND Tier 1b, had no equivalent.
  // See BUG-037.
  const stale = new Set<THREE.BufferGeometry>();

  let res: Brush;
  if (solidBrushes.length === 1) {
    res = solidBrushes[0];
  } else {
    let tempRes = solidBrushes[0];
    for (let i = 1; i < solidBrushes.length; i++) {
      const next = evaluator.evaluate(tempRes, solidBrushes[i], ADDITION);
      stale.add(tempRes.geometry);
      stale.add(solidBrushes[i].geometry);
      tempRes = next;
    }
    res = tempRes;
  }

  for (const h of holeBrushes) {
    const epsilon = 0.001;
    h.position.x += epsilon;
    h.position.y += epsilon;
    h.position.z += epsilon;
    let attempt = evaluator.evaluate(res, h, SUBTRACTION);
    h.position.x -= epsilon;
    h.position.y -= epsilon;
    h.position.z -= epsilon;

    if (attempt.geometry.index && attempt.geometry.index.count === 0) {
      // The failed attempt is thrown away entirely — retry from `res`, not
      // from the empty result, since subtracting from nothing yields nothing.
      stale.add(attempt.geometry);
      h.position.x += epsilon * 5;
      h.position.y += epsilon * 5;
      h.position.z += epsilon * 5;
      attempt = evaluator.evaluate(res, h, SUBTRACTION);
      h.position.x -= epsilon * 5;
      h.position.y -= epsilon * 5;
      h.position.z -= epsilon * 5;
    }

    stale.add(res.geometry);
    res = attempt;
  }
  holeBrushes.forEach((h) => stale.add(h.geometry));

  res.geometry.computeVertexNormals();
  const preCreaseBrush = res;
  const creased = toCreasedNormals(res.geometry, Math.PI / 6);
  if (creased !== res.geometry) stale.add(res.geometry);

  // Never dispose what we are handing back, even if it aliases something the
  // fold saw earlier (single-solid, no-hole shapes return their input brush).
  stale.forEach((g) => {
    if (g !== creased) g.dispose();
  });

  if (returnPreCreaseBrush) {
    return { geometry: creased, preCreaseBrush };
  }
  return creased;
}

/**
 * CSGGroup.tsx's boolean fold over a *group's* members (ShapeType[] —
 * placed, positioned scene shapes sharing a parentId), as opposed to
 * evaluateCustomGeometry's fold over a single shape's own CustomMember[]
 * tree. The two look similar but are NOT interchangeable: this one has an
 * anchor-relative transform (kinematic/joint groups render their CSG result
 * in the parent's local frame), a 1.01x hole-scale boost so a hole sized
 * flush with a solid's boundary still pokes through both faces (omitted
* from evaluateCustomGeometry, which has no equivalent flush-hole case),
  * and an extra mergeVertices() pass after creasing that evaluateCustomGeometry
  * doesn't do either. Extracted verbatim from CSGGroup.tsx's inline
  * `resultMesh` useMemo — same computation, now callable and testable on its
  * own, and reusable as the main-thread reference implementation
  * evaluateCSGGroupGeometryFromArrays (lib/csgEvaluation.ts) is checked
  * against.
  *
  * No window/DOM access: returns null for "not applicable" (fewer than one
  * solid or one hole — the caller's original code treated this as a normal,
  * silent state, not a warning) and THROWS for a genuine degenerate result
  * or evaluator failure, so every caller can funnel both into one catch
  * block rather than juggling three different dispatch sites the way the
  * pre-extraction inline version did.
  */
export interface EvaluateCSGGroupGeometryResult {
  brush: Brush | null;
  /** The Brush after the boolean fold but before crease/merge.
   * Returned only when `returnPreCreaseBrush` is true. */
  preCreaseBrush?: Brush;
}

// Overload 1: default behavior (backward compatible) - returns Brush | null
export function evaluateCSGGroupGeometry(
  members: ShapeType[],
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
  returnPreCreaseBrush?: false,
): Brush | null;

// Overload 2: with returnPreCreaseBrush=true - returns result object
export function evaluateCSGGroupGeometry(
  members: ShapeType[],
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
  returnPreCreaseBrush?: true,
): EvaluateCSGGroupGeometryResult;

// Implementation
export function evaluateCSGGroupGeometry(
  members: ShapeType[],
  evaluator: Evaluator,
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
  returnPreCreaseBrush: boolean = false,
): Brush | null | EvaluateCSGGroupGeometryResult {
  const solids = members.filter((s) => !s.isHole);
  const holes = members.filter((s) => s.isHole);
  if (!holes.length || !solids.length) return null;

  const mkBrush = (s: ShapeType, isHoleBrush: boolean) => {
    let geom: THREE.BufferGeometry;
    if (s.type === "custom" && s.customMembers && s.customMembers.length > 0) {
      geom = evaluateCustomGeometry(s.customMembers, evaluator, gltfGeometryMap, s.color, false, new Set(), false);
    } else if (s.type === "glb" && s.url && gltfGeometryMap?.has(s.url)) {
      geom = gltfGeometryMap.get(s.url)!.clone();
    } else {
      geom = makeBasicGeom(s.type);
    }

    let pos = s.position;
    let rot = s.rotation;
    if (isPhysics && anchor) {
      const qParent = anchorRotation
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...anchorRotation))
        : new THREE.Quaternion();
      const qChild = new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation));
      const qParentInv = qParent.clone().invert();

      const qLocal = qParentInv.clone().multiply(qChild);
      const eulerLocal = new THREE.Euler().setFromQuaternion(qLocal);
      rot = [eulerLocal.x, eulerLocal.y, eulerLocal.z];

      const posDiff = new THREE.Vector3(
        s.position[0] - anchor[0],
        s.position[1] - anchor[1],
        s.position[2] - anchor[2],
      );
      const posLocalVec = posDiff.applyQuaternion(qParentInv);
      pos = [posLocalVec.x, posLocalVec.y, posLocalVec.z];
    }

    // Hole brushes are scaled up slightly so a hole sized flush with a
    // solid's boundary (e.g. a "drill all the way through" cutter) pokes
    // through both faces instead of landing exactly coplanar with them,
    // which three-bvh-csg's boolean evaluator can fail to resolve and
    // return as empty geometry.
    const holeScaleBoost = isHoleBrush ? 1.01 : 1;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(
        s.scale[0] * holeScaleBoost,
        s.scale[1] * holeScaleBoost,
        s.scale[2] * holeScaleBoost,
      ),
    );
    geom.applyMatrix4(matrix);
    const brushColor = s.isHole ? solids[0]?.color || "#ffffff" : s.color || "#ffffff";

    if (!geom.attributes.color) {
      applyVertexColor(geom, brushColor);
    }
    applyDefaultUV(geom);

    const b = new Brush(geom);
    b.updateMatrixWorld();
    return b;
  };

  const solidBrushes = solids.map((s) => mkBrush(s, false));
  const holeBrushes = holes.map((s) => mkBrush(s, true));
  // Every intermediate/superseded geometry produced along the way gets
  // collected here and disposed once the final result is ready, so we
  // don't leak GPU buffers on every recompute (move/rotate/undo/etc.).
  const staleGeometries = new Set<THREE.BufferGeometry>();

  let res: Brush;
  if (solidBrushes.length === 1) {
    res = solidBrushes[0];
  } else {
    let tempRes = solidBrushes[0];
    for (let i = 1; i < solidBrushes.length; i++) {
      const next = evaluator.evaluate(tempRes, solidBrushes[i], ADDITION);
      staleGeometries.add(tempRes.geometry);
      staleGeometries.add(solidBrushes[i].geometry);
      tempRes = next;
    }
    res = tempRes;
  }

  for (const h of holeBrushes) {
    const epsilon = 0.001;
    h.position.x += epsilon;
    h.position.y += epsilon;
    h.position.z += epsilon;
    let attemptRes = evaluator.evaluate(res, h, SUBTRACTION);
    h.position.x -= epsilon;
    h.position.y -= epsilon;
    h.position.z -= epsilon;

    if (attemptRes.geometry.index && attemptRes.geometry.index.count === 0) {
      staleGeometries.add(attemptRes.geometry);
      h.position.x += epsilon * 5;
      h.position.y += epsilon * 5;
      h.position.z += epsilon * 5;
      // Retry from the pre-subtraction `res`, not from the failed (empty)
      // attempt — subtracting from an empty geometry can only ever produce
      // an empty geometry again.
      attemptRes = evaluator.evaluate(res, h, SUBTRACTION);
      h.position.x -= epsilon * 5;
      h.position.y -= epsilon * 5;
      h.position.z -= epsilon * 5;
    }

    staleGeometries.add(res.geometry);
    res = attemptRes;
  }
  holeBrushes.forEach((h) => staleGeometries.add(h.geometry));

  res.geometry.computeVertexNormals();
  const preCreaseBrush = res;
  const creased = toCreasedNormals(res.geometry, Math.PI / 6);
  if (creased !== res.geometry) staleGeometries.add(res.geometry);
  res.geometry = creased;
  const merged = mergeVertices(res.geometry);
  if (merged !== res.geometry) staleGeometries.add(res.geometry);
  res.geometry = merged;
  res.geometry.computeBoundingBox();
  res.geometry.computeBoundingSphere();

  staleGeometries.forEach((g) => {
    if (g !== res.geometry) g.dispose();
  });

  if (res.geometry.index && res.geometry.index.count === 0) {
    throw new Error(
      "CSG subtraction resulted in empty shape (0 indices). Shapes may have identical dimensions.",
    );
  }
  if (res.geometry.attributes.position && res.geometry.attributes.position.count === 0) {
    throw new Error(
      "CSG subtraction resulted in empty shape (0 positions). Shapes may have identical dimensions.",
    );
  }

  if (returnPreCreaseBrush) {
    return { brush: res, preCreaseBrush };
  }
  return res;
}
