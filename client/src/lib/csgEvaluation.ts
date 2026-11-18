import * as THREE from "three";
import { Evaluator, Brush, ADDITION, SUBTRACTION } from "three-bvh-csg";
import { toCreasedNormals, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CustomMember, ShapeType } from "../pages/CadStudio";
import {
  evaluateCustomGeometry,
  evaluateCSGGroupGeometry,
  type EvaluateCustomGeometryResult,
  type EvaluateCSGGroupGeometryResult,
} from "../components/canvas/utils/geometryHelpers";
import { reconstructGlbGeometry, type GlbGeometryArrays } from "./workerGlbRegistry";
import {
  makeBasicGeom,
  applyVertexColor,
  applyDefaultUV,
} from "../components/canvas/utils/geometryHelpers";

export type CSGResultArrays = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array | Uint16Array;
};

const EMPTY_RESULT: CSGResultArrays = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  uvs: new Float32Array(0),
  indices: new Uint32Array(0),
};

function geometryToArrays(geom: THREE.BufferGeometry): CSGResultArrays {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  const norm = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const col = geom.getAttribute("color") as THREE.BufferAttribute | undefined;
  const uv = geom.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const idx = geom.index;
  return {
    positions: new Float32Array(pos.array as ArrayLike<number>),
    normals: norm ? new Float32Array(norm.array as ArrayLike<number>) : new Float32Array(0),
    // evaluator.attributes includes "color" precisely so a multi-color CSG
    // merge (or any member whose shape.color feeds applyVertexColor) keeps
    // its per-vertex color through the boolean fold. Dropping it here left
    // the reconstructed geometry with no "color" attribute at all — for any
    // shape whose material sets vertexColors=true (getShapeMaterialProps
    // does this whenever a custom shape's own color is white, which is the
    // common case for a merged CSG result), WebGL samples the disabled
    // attribute's default (0,0,0) and renders solid black.
    colors: col ? new Float32Array(col.array as ArrayLike<number>) : new Float32Array(0),
    // Same reasoning as colors, for texture mapping: without "uv" surviving
    // the fold, a material's `map` has nothing to sample by.
    uvs: uv ? new Float32Array(uv.array as ArrayLike<number>) : new Float32Array(0),
    indices: idx
      ? idx.array instanceof Uint16Array
        ? new Uint16Array(idx.array)
        : new Uint32Array(idx.array as ArrayLike<number>)
      : new Uint32Array(0),
  };
}

function buildGltfGeometryMap(
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
): Map<string, THREE.BufferGeometry> {
  const map = new Map<string, THREE.BufferGeometry>();
  glbArraysByUrl.forEach((arrays, url) => map.set(url, reconstructGlbGeometry(arrays)));
  return map;
}

/**
 * Worker-portable CSG evaluation. Takes only serializable inputs (a member
 * tree, plus raw GLB arrays keyed by URL) and returns only serializable
 * outputs (typed arrays) — no live THREE.Object3D, Evaluator, or
 * gltfGeometryMap crosses in or out. Delegates the actual fold to
 * evaluateCustomGeometry unchanged: same recursive member-tree walk, same
 * identity-based cycle detection, same epsilon-nudge retry for a degenerate
 * hole subtraction. Output is expected to be identical to calling
 * evaluateCustomGeometry directly with a live gltfGeometryMap — this only
 * changes where that map's "glb" entries come from (a worker-local
 * reconstruction from arrays, vs. Canvas3D.tsx's live merged geometry) —
 * see csgEvaluation.test.ts for the equivalence check.
 *
 * Callers own disposing nothing extra: this function disposes its own
 * intermediate geometries (the reconstructed GLB map, the CSG result) before
 * returning, since only the returned arrays are meant to outlive the call.
 */
export function evaluateCustomGeometryFromArrays(
  members: CustomMember[],
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
  fallbackColor?: string,
): CSGResultArrays {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "color", "uv"];

  const gltfGeometryMap = buildGltfGeometryMap(glbArraysByUrl);
  const geometry = evaluateCustomGeometry(members, evaluator, gltfGeometryMap, fallbackColor, false, new Set(), false);
  const out = geometryToArrays(geometry);

  geometry.dispose();
  gltfGeometryMap.forEach((g) => g.dispose());

  return out;
}

/**
 * Worker-portable version of evaluateCSGGroupGeometry (CSGGroup.tsx's own
 * fold over a group's ShapeType[] members — a different algorithm from
 * evaluateCustomGeometry, see that function's doc comment). Same
 * serializable-in/serializable-out shape as evaluateCustomGeometryFromArrays.
 *
 * Returns EMPTY_RESULT (positions.length === 0) both when the group has no
 * mergeable result yet (fewer than one solid or one hole — the original
 * inline code's silent early-exit, not a warning) and — via the caller's
 * try/catch — never for a genuine failure, which is left to throw so the
 * caller can distinguish "nothing to render yet" from "something went
 * wrong" if it wants to. See csgWorker.ts's compute handler.
 */
export function evaluateCSGGroupGeometryFromArrays(
  members: ShapeType[],
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
): CSGResultArrays {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "color", "uv"];

  const gltfGeometryMap = buildGltfGeometryMap(glbArraysByUrl);
  const brush = evaluateCSGGroupGeometry(
    members,
    evaluator,
    gltfGeometryMap,
    isPhysics,
    anchor,
    anchorRotation,
    false,
  );

  const out = brush ? geometryToArrays(brush.geometry) : EMPTY_RESULT;

  brush?.geometry.dispose();
  gltfGeometryMap.forEach((g) => g.dispose());

  return out;
}

/**
 * Main-thread-side inverse of evaluateCustomGeometryFromArrays's output —
 * used by the (future) useCSGWorker onmessage handler and by tests that
 * need to inspect the result as a real BufferGeometry.
 */
export function arraysToGeometry(result: CSGResultArrays): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
  if (result.normals.length > 0) {
    geom.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
  }
  if (result.colors.length > 0) {
    geom.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
  }
  if (result.uvs.length > 0) {
    geom.setAttribute("uv", new THREE.BufferAttribute(result.uvs, 2));
  }
  if (result.indices.length > 0) {
    geom.setIndex(new THREE.BufferAttribute(result.indices, 1));
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** Result of a CSG evaluation that includes the pre-crease brush for caching.
 * `preCreaseBrush` is null when the evaluation produced nothing to fold (e.g. a
 * group with no holes, or no solids) — the caller must not cache a prefix in
 * that case. */
export interface CSGEvalWithBrushResult {
  arrays: CSGResultArrays;
  preCreaseBrush: Brush | null;
}

/**
 * Worker-side evaluation that returns the pre-crease brush for incremental caching.
 * The caller owns the returned brush and must dispose its geometry when done.
 */
export function evaluateCustomGeometryFromArraysWithBrush(
  members: CustomMember[],
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
  fallbackColor?: string,
): CSGEvalWithBrushResult {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "color", "uv"];

  const gltfGeometryMap = buildGltfGeometryMap(glbArraysByUrl);
  // Use type assertion to get the overload with returnPreCreaseBrush=true
  const result = evaluateCustomGeometry(
    members,
    evaluator,
    gltfGeometryMap,
    fallbackColor,
    false,
    new Set(),
    true as const,
  ) as EvaluateCustomGeometryResult;

  const arrays = geometryToArrays(result.geometry);

  // The caller (worker) will cache preCreaseBrush and must dispose it later
  const preCreaseBrush = result.preCreaseBrush!;

  result.geometry.dispose();
  gltfGeometryMap.forEach((g) => g.dispose());

  return { arrays, preCreaseBrush };
}

/**
 * Worker-side group evaluation that returns the pre-crease brush for incremental caching.
 */
export function evaluateCSGGroupGeometryFromArraysWithBrush(
  members: ShapeType[],
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
): CSGEvalWithBrushResult {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "color", "uv"];

  const gltfGeometryMap = buildGltfGeometryMap(glbArraysByUrl);
  const result = evaluateCSGGroupGeometry(
    members,
    evaluator,
    gltfGeometryMap,
    isPhysics,
    anchor,
    anchorRotation,
    true as const,
  ) as EvaluateCSGGroupGeometryResult | null;

  // evaluateCSGGroupGeometry returns null for a "not applicable" group (no
  // holes, or no solids) — a normal transient/valid state, not an error. The
  // non-brush sibling already handled this; this path must too, or `result`
  // is null and `result.brush` throws.
  if (!result || !result.brush) {
    result?.preCreaseBrush?.geometry?.dispose();
    gltfGeometryMap.forEach((g) => g.dispose());
    return { arrays: EMPTY_RESULT, preCreaseBrush: null };
  }

  const arrays = geometryToArrays(result.brush.geometry);

  // The caller (worker) will cache preCreaseBrush and must dispose it later
  const preCreaseBrush = result.preCreaseBrush ?? null;

  result.brush.geometry.dispose();
  gltfGeometryMap.forEach((g) => g.dispose());

  return { arrays, preCreaseBrush };
}

/**
 * Apply a single incremental boolean operation (ADDITION or SUBTRACTION) to a brush.
 * Returns a new brush with the operation applied. The input brush is NOT modified.
 * Caller must dispose both the input brush geometry (if no longer needed) and the
 * returned brush geometry.
 */
export function applyIncrementalOp(
  evaluator: Evaluator,
  baseBrush: Brush,
  newBrush: Brush,
  op: typeof ADDITION | typeof SUBTRACTION,
): Brush {
  // The evaluator returns a new brush; the base brush is not modified.
  // We need to keep baseBrush geometry alive if caller still needs it.
  return evaluator.evaluate(baseBrush, newBrush, op);
}

/**
 * Apply crease (and optionally mergeVertices for group path) to a brush and
 * convert to transferable arrays. Disposes the input brush geometry.
 */
export function finalizeBrush(
  brush: Brush,
  isGroupPath: boolean,
): CSGResultArrays {
  brush.geometry.computeVertexNormals();
  const creased = toCreasedNormals(brush.geometry, Math.PI / 6);

  let finalGeom = creased;
  if (isGroupPath) {
    const merged = mergeVertices(finalGeom);
    if (merged !== finalGeom) {
      finalGeom = merged;
    }
  }
  finalGeom.computeBoundingBox();
  finalGeom.computeBoundingSphere();

  const arrays = geometryToArrays(finalGeom);

  // Dispose intermediate geometries
  if (creased !== brush.geometry) brush.geometry.dispose();
  if (finalGeom !== creased) creased.dispose();
  // Note: if finalGeom is neither brush.geometry nor creased, it's merged and we already disposed creased

  return arrays;
}

/**
 * Create a Brush for a single member (CustomMember or ShapeType) from GLB arrays.
 * Used by the worker for incremental evaluation - creates a brush for just the
 * new member being added/subtracted.
 */
export function createMemberBrush(
  member: CustomMember | ShapeType,
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
  fallbackColor?: string,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
): Brush {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "color", "uv"];

  // Build gltfGeometryMap from arrays
  const gltfGeometryMap = new Map<string, THREE.BufferGeometry>();
  glbArraysByUrl.forEach((arrays, url) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(arrays.positions, 3));
    if (arrays.normals) geom.setAttribute("normal", new THREE.Float32BufferAttribute(arrays.normals, 3));
    if (arrays.uvs) geom.setAttribute("uv", new THREE.Float32BufferAttribute(arrays.uvs, 2));
    if (arrays.indices) geom.setIndex(new THREE.Uint32BufferAttribute(arrays.indices, 1));
    geom.computeVertexNormals();
    gltfGeometryMap.set(url, geom);
  });

  let geom: THREE.BufferGeometry;
  const isGroup = "id" in member && "position" in member && !("offset" in member);

  if (isGroup) {
    const s = member as ShapeType;
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

    const holeScaleBoost = s.isHole ? 1.01 : 1;
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
    const brushColor = s.isHole ? "#ffffff" : s.color || "#ffffff";

    if (!geom.attributes.color) {
      applyVertexColor(geom, brushColor);
    }
    applyDefaultUV(geom);
} else {
    const m = member as CustomMember;
    if (m.type === "custom" && m.customMembers && m.customMembers.length > 0) {
      geom = evaluateCustomGeometry(m.customMembers, evaluator, gltfGeometryMap, m.color || fallbackColor, false, new Set(), false);
    } else if (m.type === "glb" && m.url && gltfGeometryMap?.has(m.url)) {
      geom = gltfGeometryMap.get(m.url)!.clone();
    } else {
      geom = makeBasicGeom(m.type);
    }

    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...m.offset),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...m.rotation)),
      new THREE.Vector3(m.scale[0], m.scale[1], m.scale[2]),
    );
    geom.applyMatrix4(matrix);
    geom.computeVertexNormals();

    if (!geom.attributes.color) {
      applyVertexColor(geom, m.color || fallbackColor || "#ffffff");
    }
    applyDefaultUV(geom);
  }

  const b = new Brush(geom);
  b.updateMatrixWorld();

  // Clean up the gltfGeometryMap
  gltfGeometryMap.forEach((g) => g.dispose());

  return b;
}

/**
 * Apply incremental boolean operation using a cached base brush and a new member.
 * This is the core of the incremental path - applies just one ADDITION or SUBTRACTION
 * to the cached result instead of recomputing the entire fold.
 */
export function evaluateIncrementalCSG(
  evaluator: Evaluator,
  baseBrush: Brush,
  newMember: CustomMember | ShapeType,
  glbArraysByUrl: Map<string, GlbGeometryArrays>,
  isGroupPath: boolean,
  isHole: boolean,
  fallbackColor?: string,
  isPhysics?: boolean,
  anchor?: [number, number, number],
  anchorRotation?: [number, number, number],
): CSGResultArrays {
  const newBrush = createMemberBrush(
    newMember,
    glbArraysByUrl,
    fallbackColor,
    isPhysics,
    anchor,
    anchorRotation,
  );
  const resultBrush = applyIncrementalOp(evaluator, baseBrush, newBrush, isHole ? SUBTRACTION : ADDITION);
  return finalizeBrush(resultBrush, isGroupPath);
}
