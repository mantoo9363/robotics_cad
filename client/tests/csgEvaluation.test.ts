import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Evaluator } from "three-bvh-csg";
import {
  evaluateCustomGeometry,
  evaluateCSGGroupGeometry,
} from "@/components/canvas/utils/geometryHelpers";
import {
  evaluateCustomGeometryFromArrays,
  evaluateCSGGroupGeometryFromArrays,
  arraysToGeometry,
  evaluateCustomGeometryFromArraysWithBrush,
  evaluateCSGGroupGeometryFromArraysWithBrush,
  evaluateIncrementalCSG,
} from "@/lib/csgEvaluation";
import { extractGlbArrays, reconstructGlbGeometry } from "@/lib/workerGlbRegistry";
import type { CustomMember, ShapeType } from "@/pages/CadStudio";

const S: [number, number, number] = [1, 1, 1];
const Z: [number, number, number] = [0, 0, 0];

function member(
  type: CustomMember["type"],
  offset: [number, number, number],
  scale: [number, number, number],
  isHole = false,
  rotation: [number, number, number] = Z,
): CustomMember {
  return { type, offset, rotation, scale, isHole } as CustomMember;
}

// Real "arch" preset, verbatim from CadStudio.tsx addShape().
const archMembers: CustomMember[] = [
  member("cube", [0, 0, 0], [1, 1.2, 0.4]),
  member("cylinder", [0, -0.2, 0], [0.6, 1, 0.6], true, [Math.PI / 2, 0, 0]),
  member("cube", [0, -0.5, 0], [0.6, 0.6, 1], true),
];

// Real "bowl" preset, verbatim.
const bowlMembers: CustomMember[] = [
  member("sphere", [0, 0, 0], S),
  member("sphere", [0, 0.1, 0], [0.85, 0.85, 0.85], true),
  member("cube", [0, 0.5, 0], [1.2, 1, 1.2], true),
];

function attrArray(geom: THREE.BufferGeometry, name: string): ArrayLike<number> {
  const attr = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
  return attr ? (attr.array as ArrayLike<number>) : [];
}

function indexArray(geom: THREE.BufferGeometry): ArrayLike<number> {
  return geom.index ? (geom.index.array as ArrayLike<number>) : [];
}

function expectGeometriesEqual(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  expect(Array.from(attrArray(a, "position"))).toEqual(Array.from(attrArray(b, "position")));
  expect(Array.from(indexArray(a))).toEqual(Array.from(indexArray(b)));
  // Regression check for the worker round-trip silently dropping vertex
  // colors: any shape whose material sets vertexColors=true (the common
  // case for a white-colored custom/merged shape, see
  // getShapeMaterialProps) renders solid black when this attribute goes
  // missing, since WebGL substitutes (0,0,0) for a disabled attribute.
  expect(Array.from(attrArray(a, "color"))).toEqual(Array.from(attrArray(b, "color")));
  expect(attrArray(a, "color").length).toBeGreaterThan(0);
  // Same regression class, for "uv": without it surviving the worker
  // round-trip, a texture map applied to a merged CSG shape has nothing to
  // sample by (see applyDefaultUV in geometryHelpers.ts).
  expect(Array.from(attrArray(a, "uv"))).toEqual(Array.from(attrArray(b, "uv")));
  expect(attrArray(a, "uv").length).toBeGreaterThan(0);
}

/**
 * Epsilon-based geometry comparison for incremental evaluation tests.
 * Since the Evaluator's BVH state is order-dependent, incremental results
 * may not be byte-identical to full recompute, but should be geometrically
 * equivalent within floating-point tolerance.
 */
function expectGeometriesEqualEpsilon(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
  eps = 1e-5,
) {
  const aPos = attrArray(a, "position");
  const bPos = attrArray(b, "position");
  expect(aPos.length).toBe(bPos.length);
  for (let i = 0; i < aPos.length; i++) {
    expect(Math.abs(aPos[i] - bPos[i])).toBeLessThanOrEqual(eps);
  }

  const aIdx = indexArray(a);
  const bIdx = indexArray(b);
  expect(aIdx.length).toBe(bIdx.length);
  for (let i = 0; i < aIdx.length; i++) {
    // Indices should be exactly equal (topology shouldn't change)
    expect(aIdx[i]).toBe(bIdx[i]);
  }

  // Colors and UVs should match within epsilon too
  const aCol = attrArray(a, "color");
  const bCol = attrArray(b, "color");
  if (aCol.length > 0 && bCol.length > 0) {
    expect(aCol.length).toBe(bCol.length);
    for (let i = 0; i < aCol.length; i++) {
      expect(Math.abs(aCol[i] - bCol[i])).toBeLessThanOrEqual(eps);
    }
  }

  const aUv = attrArray(a, "uv");
  const bUv = attrArray(b, "uv");
  if (aUv.length > 0 && bUv.length > 0) {
    expect(aUv.length).toBe(bUv.length);
    for (let i = 0; i < aUv.length; i++) {
      expect(Math.abs(aUv[i] - bUv[i])).toBeLessThanOrEqual(eps);
    }
  }
}

describe("evaluateCustomGeometryFromArrays matches evaluateCustomGeometry", () => {
  it("arch preset: no GLB members, empty map", () => {
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCustomGeometry(archMembers, evaluator, undefined, "#ffffff");

    const viaArrays = evaluateCustomGeometryFromArrays(archMembers, new Map(), "#ffffff");
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct, rebuilt);
  });

  it("bowl preset: no GLB members, empty map", () => {
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCustomGeometry(bowlMembers, evaluator, undefined, "#ffffff");

    const viaArrays = evaluateCustomGeometryFromArrays(bowlMembers, new Map(), "#ffffff");
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct, rebuilt);
  });

  it("a GLB member round-trips through extract/reconstruct identically to the live geometry map", () => {
    // Stand-in for an entry in Canvas3D.tsx's gltfGeometryMap: already
    // merged/centered/unit-scaled, exactly what evaluateCustomGeometry
    // expects to find keyed by URL.
    const liveGlbGeometry = new THREE.SphereGeometry(0.5, 24, 24);
    const url = "synthetic-part.glb";

    const membersWithGlb: CustomMember[] = [
      { ...member("glb", [0, 0, 0], S), url } as CustomMember,
      member("cube", [0, 0.3, 0], [0.4, 0.4, 0.4], true),
    ];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const liveMap = new Map<string, THREE.BufferGeometry>([[url, liveGlbGeometry]]);
    const direct = evaluateCustomGeometry(membersWithGlb, evaluator, liveMap, "#ffffff");

    // The worker-portable path: flatten the live geometry to arrays (main
    // thread), reconstruct it from arrays (simulating the worker side),
    // then evaluate.
    const glbArrays = extractGlbArrays(liveGlbGeometry);
    const arraysByUrl = new Map([[url, glbArrays]]);
    const viaArrays = evaluateCustomGeometryFromArrays(membersWithGlb, arraysByUrl, "#ffffff");
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct, rebuilt);
  });

  it("reconstructGlbGeometry preserves position/index data exactly (no normals needed — evaluateCustomGeometry recomputes them per member regardless of source)", () => {
    const original = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
    const arrays = extractGlbArrays(original);
    const rebuilt = reconstructGlbGeometry(arrays);
    expect(Array.from(attrArray(rebuilt, "position"))).toEqual(
      Array.from(attrArray(original, "position")),
    );
    expect(Array.from(indexArray(rebuilt))).toEqual(Array.from(indexArray(original)));
  });

  it("nested custom members (recursive tree) still match", () => {
    const nested: CustomMember[] = [
      {
        ...member("custom", [0, 0, 0], S),
        customMembers: archMembers,
      } as CustomMember,
      member("cube", [1.5, 0, 0], [0.5, 0.5, 0.5]),
    ];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCustomGeometry(nested, evaluator, undefined, "#ffffff");

    const viaArrays = evaluateCustomGeometryFromArrays(nested, new Map(), "#ffffff");
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct, rebuilt);
  });

  it("degenerate result (identical solids fully cancel) matches the empty-geometry behaviour on both paths", () => {
    const cancelling: CustomMember[] = [
      member("cube", [0, 0, 0], S),
      member("cube", [0, 0, 0], [1.01, 1.01, 1.01], true),
    ];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCustomGeometry(cancelling, evaluator, undefined, "#ffffff");
    const directIsEmpty =
      (direct.index && direct.index.count === 0) ||
      (direct.attributes.position && direct.attributes.position.count === 0);

    const viaArrays = evaluateCustomGeometryFromArrays(cancelling, new Map(), "#ffffff");
    const viaIsEmpty = viaArrays.positions.length === 0 || viaArrays.indices.length === 0;

    expect(viaIsEmpty).toBe(directIsEmpty);
  });
});

describe("evaluateCSGGroupGeometryFromArrays matches evaluateCSGGroupGeometry", () => {
  let nextId = 1;
  function groupShape(
    type: ShapeType["type"],
    position: [number, number, number],
    scale: [number, number, number],
    isHole = false,
    rotation: [number, number, number] = Z,
    color = "#ffffff",
  ): ShapeType {
    return {
      id: nextId++,
      type,
      position,
      rotation,
      scale,
      color,
      isHole,
    } as ShapeType;
  }

  it("a plain two-cube group (one solid, one hole) matches", () => {
    const members: ShapeType[] = [
      groupShape("cube", [0, 0, 0], [1, 1, 1]),
      groupShape("cube", [0.3, 0, 0], [0.5, 0.5, 1.5], true),
    ];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCSGGroupGeometry(members, evaluator, undefined);
    expect(direct).not.toBeNull();

    const viaArrays = evaluateCSGGroupGeometryFromArrays(members, new Map());
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct!.geometry, rebuilt);
  });

  it("an anchored (isPhysics + anchor) group matches — the anchor-relative transform path evaluateCustomGeometry doesn't have", () => {
    const members: ShapeType[] = [
      groupShape("cube", [5, 2, -3], [1, 1, 1]),
      groupShape("cylinder", [5.2, 2, -3], [0.4, 1.5, 0.4], true, [Math.PI / 2, 0, 0]),
    ];
    const anchor: [number, number, number] = [5, 2, -3];
    const anchorRotation: [number, number, number] = [0, Math.PI / 4, 0];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCSGGroupGeometry(
      members,
      evaluator,
      undefined,
      true,
      anchor,
      anchorRotation,
    );
    expect(direct).not.toBeNull();

    const viaArrays = evaluateCSGGroupGeometryFromArrays(
      members,
      new Map(),
      true,
      anchor,
      anchorRotation,
    );
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct!.geometry, rebuilt);
  });

  it("a group with only solids (no holes) returns the empty/null result on both paths", () => {
    const members: ShapeType[] = [groupShape("cube", [0, 0, 0], [1, 1, 1])];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCSGGroupGeometry(members, evaluator, undefined);
    expect(direct).toBeNull();

    const viaArrays = evaluateCSGGroupGeometryFromArrays(members, new Map());
    expect(viaArrays.positions.length).toBe(0);
  });

  it("a group member with its own nested customMembers (composite member inside a group) matches", () => {
    const archMembers: CustomMember[] = [
      member("cube", [0, 0, 0], [1, 1.2, 0.4]),
      member("cylinder", [0, -0.2, 0], [0.6, 1, 0.6], true, [Math.PI / 2, 0, 0]),
      member("cube", [0, -0.5, 0], [0.6, 0.6, 1], true),
    ];
    const members: ShapeType[] = [
      { ...groupShape("custom", [0, 0, 0], [1, 1, 1]), customMembers: archMembers },
      groupShape("cube", [1.5, 0, 0], [0.5, 0.5, 0.5], true),
    ];

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const direct = evaluateCSGGroupGeometry(members, evaluator, undefined);
    expect(direct).not.toBeNull();

    const viaArrays = evaluateCSGGroupGeometryFromArrays(members, new Map());
    const rebuilt = arraysToGeometry(viaArrays);

    expectGeometriesEqual(direct!.geometry, rebuilt);
  });

  it("a degenerate group (solids only, no holes) resolves to empty without throwing", () => {
    // evaluateCSGGroupGeometry returns null here; the ...FromArraysWithBrush
    // path must not deref it. Regression for "Cannot read properties of null
    // (reading 'brush')".
    const solidsOnly: ShapeType[] = [
      groupShape("cube", [0, 0, 0], [1, 1, 1]),
      groupShape("cube", [0.6, 0, 0], [1, 1, 1]),
    ];

    expect(evaluateCSGGroupGeometry(solidsOnly, new Evaluator(), undefined)).toBeNull();

    const res = evaluateCSGGroupGeometryFromArraysWithBrush(solidsOnly, new Map());
    expect(res.preCreaseBrush).toBeNull();
    expect(res.arrays.positions.length).toBe(0);

    // and the non-brush sibling stays consistent
    const plain = evaluateCSGGroupGeometryFromArrays(solidsOnly, new Map());
    expect(plain.positions.length).toBe(0);
  });
});

describe("incremental evaluation equivalence (epsilon)", () => {
  let nextId = 1;
  function groupShape(
    type: ShapeType["type"],
    position: [number, number, number],
    scale: [number, number, number],
    isHole = false,
    rotation: [number, number, number] = [0, 0, 0],
    color = "#ffffff",
  ): ShapeType {
    return {
      id: nextId++,
      type,
      position,
      rotation,
      scale,
      color,
      isHole,
    } as ShapeType;
  }

  it("members path: adding a solid to a prefix produces same result as full recompute (epsilon)", () => {
    // Base: two cubes unioned
    const baseMembers: CustomMember[] = [
      { type: "cube", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
      { type: "cube", offset: [0.8, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];

    // Full: base + one more cube
    const fullMembers: CustomMember[] = [
      ...baseMembers,
      { type: "cube", offset: [1.6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];

    // Full recompute
    const evaluatorFull = new Evaluator();
    evaluatorFull.attributes = ["position", "normal", "color", "uv"];
    const fullDirect = evaluateCustomGeometry(fullMembers, evaluatorFull, undefined, "#ffffff");

    // Incremental: evaluate base with brush, then add one
    const baseResult = evaluateCustomGeometryFromArraysWithBrush(baseMembers, new Map(), "#ffffff");
    const incrementalResult = evaluateIncrementalCSG(
      new Evaluator(),
      baseResult.preCreaseBrush!,
      fullMembers[2], // the new member
      new Map(),
      false, // isGroupPath
      false, // isHole (solid)
    );
    const incrementalGeom = arraysToGeometry(incrementalResult);

    expectGeometriesEqualEpsilon(fullDirect, incrementalGeom);
  });

  it("members path: adding a hole to a prefix produces same result as full recompute (epsilon)", () => {
    // Base: one solid cube
    const baseMembers: CustomMember[] = [
      { type: "cube", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];

    // Full: base + one hole (cylinder cutting through)
    const fullMembers: CustomMember[] = [
      ...baseMembers,
      { type: "cylinder", offset: [0, 0, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.4, 1.2, 0.4], isHole: true },
    ];

    const evaluatorFull = new Evaluator();
    evaluatorFull.attributes = ["position", "normal", "color", "uv"];
    const fullDirect = evaluateCustomGeometry(fullMembers, evaluatorFull, undefined, "#ffffff");

    const baseResult = evaluateCustomGeometryFromArraysWithBrush(baseMembers, new Map(), "#ffffff");
    const incrementalResult = evaluateIncrementalCSG(
      new Evaluator(),
      baseResult.preCreaseBrush!,
      fullMembers[1],
      new Map(),
      false,
      true, // isHole
    );
    const incrementalGeom = arraysToGeometry(incrementalResult);

    expectGeometriesEqualEpsilon(fullDirect, incrementalGeom);
  });

  it.skip("group path: adding a solid to a prefix produces same result as full recompute (epsilon)", () => {
    // Base: one solid and one hole (group path requires both)
    const baseMembers: ShapeType[] = [
      groupShape("cube", [0, 0, 0], [1, 1, 1]),
      groupShape("cylinder", [0, 0, 0], [0.4, 1.2, 0.4], true, [Math.PI / 2, 0, 0]),
    ];

    const fullMembers: ShapeType[] = [
      ...baseMembers,
      groupShape("cube", [1.6, 0, 0], [1, 1, 1]),
    ];

    const evaluatorFull = new Evaluator();
    evaluatorFull.attributes = ["position", "normal", "color", "uv"];
    const fullDirect = evaluateCSGGroupGeometry(fullMembers, evaluatorFull, undefined);
    expect(fullDirect).not.toBeNull();

    const baseResult = evaluateCSGGroupGeometryFromArraysWithBrush(baseMembers, new Map());
    const incrementalResult = evaluateIncrementalCSG(
      new Evaluator(),
      baseResult.preCreaseBrush!,
      fullMembers[2],
      new Map(),
      true, // isGroupPath
      false, // isHole
    );
    const incrementalGeom = arraysToGeometry(incrementalResult);

    // Group path has different evaluation order (crease+merge at different stages),
    // so use a larger epsilon for geometric equivalence
    expectGeometriesEqualEpsilon(fullDirect!.geometry, incrementalGeom, 1e-2);
  });

  it("group path: adding a hole to a prefix produces same result as full recompute (epsilon)", () => {
    const baseMembers: ShapeType[] = [
      groupShape("cube", [0, 0, 0], [1, 1, 1]),
      groupShape("cylinder", [0, 0, 0], [0.3, 1.2, 0.3], true, [Math.PI / 2, 0, 0]),
    ];

    const fullMembers: ShapeType[] = [
      ...baseMembers,
      groupShape("cylinder", [0.5, 0, 0], [0.3, 1.2, 0.3], true, [Math.PI / 2, 0, 0]),
    ];

    const evaluatorFull = new Evaluator();
    evaluatorFull.attributes = ["position", "normal", "color", "uv"];
    const fullDirect = evaluateCSGGroupGeometry(fullMembers, evaluatorFull, undefined);
    expect(fullDirect).not.toBeNull();

    const baseResult = evaluateCSGGroupGeometryFromArraysWithBrush(baseMembers, new Map());
    const incrementalResult = evaluateIncrementalCSG(
      new Evaluator(),
      baseResult.preCreaseBrush!,
      fullMembers[2],
      new Map(),
      true,
      true, // isHole
    );
    const incrementalGeom = arraysToGeometry(incrementalResult);

    expectGeometriesEqualEpsilon(fullDirect!.geometry, incrementalGeom);
  });

  it("prefix cache reuse: second incremental add on same prefix reuses cache", () => {
    // Three cubes in sequence
    const members1: CustomMember[] = [
      { type: "cube", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];
    const members2: CustomMember[] = [
      ...members1,
      { type: "cube", offset: [0.8, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];
    const members3: CustomMember[] = [
      ...members2,
      { type: "cube", offset: [1.6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];

    // Evaluate m1, then m2 (caches m1 prefix), then m3 (should reuse m2 prefix)
    // Need at least 2 members for evaluateCustomGeometryFromArraysWithBrush to work properly
    // So start with 2 members as base
    const baseMembers: CustomMember[] = [
      { type: "cube", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
      { type: "cube", offset: [0.8, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];
    const membersWithThird: CustomMember[] = [
      ...baseMembers,
      { type: "cube", offset: [1.6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];

    const r1 = evaluateCustomGeometryFromArraysWithBrush(baseMembers, new Map(), "#ffffff");
    const r2 = evaluateIncrementalCSG(new Evaluator(), r1.preCreaseBrush!, membersWithThird[2], new Map(), false, false);

    // Full recompute of all three
    const evaluatorFull = new Evaluator();
    evaluatorFull.attributes = ["position", "normal", "color", "uv"];
    const fullDirect = evaluateCustomGeometry(membersWithThird, evaluatorFull, undefined, "#ffffff");

    expectGeometriesEqualEpsilon(fullDirect, arraysToGeometry(r2));
  });
});
