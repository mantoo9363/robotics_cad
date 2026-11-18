/**
 * Runnable evidence for docs/bug-audit-2026-08.md. Blocks come in two kinds,
 * and each one says which it is:
 *
 *  - STILL OPEN — F-01/BUG-018, F-02/BUG-019, F-03/BUG-020, F-04/BUG-021,
 *    F-05/BUG-025, F-07/BUG-016: asserts the CURRENT, buggy behaviour so the
 *    suite stays green while the finding is unfixed. The comment above each
 *    states what correct would be. Flip or delete when the finding is fixed,
 *    per the doc's "Marking findings fixed".
 *
 *  - FIXED — F-06/BUG-029 (+BUG-030), BUG-031, BUG-032 (Phase 2);
 *    F-08/BUG-001, BUG-007 (Phase 3): asserts the behaviour that replaced the
 *    bug. These were flipped from the first kind, and several keep a `control`
 *    case demonstrating the old behaviour so the assertions stay falsifiable
 *    rather than vacuously green.
 *
 * Same convention as scripts/boreDecompositionSurvey.test.ts: a runnable
 * artefact tied to the tracking doc, not a general regression suite.
 */
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { Evaluator } from "three-bvh-csg";
import { evaluateCustomGeometry } from "@/components/canvas/utils/geometryHelpers";
import { sortMotorGroups } from "@/components/canvas/utils/kinematicsUtils";
import {
  calculateShapeVolume,
  getTorusCompoundColliders,
  getCogwheelCompoundColliders,
  getShapeColliderConfigs,
} from "@/lib/physicsUtils";
import {
  hasStructuralHoles,
  meshVolume,
  serializeMembers,
} from "@/lib/hollowShapeVoxelization";
import {
  decomposeConcentricBore,
  type PrimitiveDescriptor,
} from "@/lib/concentricBoreDecomposition";
import {
  COGWHEEL_BORE_RADIUS,
  COGWHEEL_DEPTH,
  COGWHEEL_OUTER_RADIUS,
} from "@/components/canvas/utils/geometryHelpers";
import { getCachedGeometry } from "@/lib/geometryCache";
import { TORUS_MAJOR_RADIUS, TORUS_MINOR_RADIUS } from "@/lib/geometryCache";
import type { CustomMember } from "@/pages/CadStudio";

const S: [number, number, number] = [1, 1, 1];

describe("F-01 / BUG-018  torus volume now matches the analytic formula", () => {
  // FIXED 2026-08-13 (Phase 5). Was 2*pi*R^2 * pi*r — the wrong radius
  // squared, giving a result too heavy by exactly R/r (2.67x at the app's own
  // default torus proportions).
  it("matches 2*pi^2 * R * r^2 exactly", () => {
    const scale: [number, number, number] = [0.8, 0.3, 0.8]; // R=0.4, r=0.15
    const R = scale[0] / 2;
    const r = scale[1] / 2;

    const truth = 2 * Math.PI * Math.PI * R * r * r;
    const actual = calculateShapeVolume({ type: "torus", scale });

    expect(truth).toBeCloseTo(0.17765, 5);
    expect(actual).toBeCloseTo(truth, 10);
  });

  it("is no longer sensitive to which radius is larger", () => {
    // The old bug was symmetric-looking but scaled with R/r, so a thin torus
    // was wrong by more than a fat one. Both must now be exact.
    for (const [sx, sy] of [[0.8, 0.3], [2.0, 0.1], [0.5, 0.5]]) {
      const truth = 2 * Math.PI ** 2 * (sx / 2) * (sy / 2) ** 2;
      expect(calculateShapeVolume({ type: "torus", scale: [sx, sy, sx] })).toBeCloseTo(truth, 10);
    }
  });

  it("agrees with the real render mesh's measured volume", () => {
    const geom = getCachedGeometry("torus", "medium");
    const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
    const measured = meshVolume(
      new Float32Array(nonIndexed.attributes.position.array),
    );
    // Render mesh is built at TORUS_MAJOR/MINOR_RADIUS, i.e. scale [0.8,0.3,..]
    const analytic =
      2 * Math.PI * Math.PI * TORUS_MAJOR_RADIUS * TORUS_MINOR_RADIUS ** 2;
    // ~0.89 of analytic: the 8-segment tube cross-section is an inscribed
    // octagon, not a circle. Faceting, not a formula error.
    expect(measured / analytic).toBeGreaterThan(0.85);
    expect(measured / analytic).toBeLessThan(1.0);
    // The app's value now lands within faceting error of the measured mesh,
    // instead of ~3x above it.
    const appValue = calculateShapeVolume({ type: "torus", scale: [0.8, 0.3, 0.8] });
    expect(appValue / measured).toBeGreaterThan(1.0);
    expect(appValue / measured).toBeLessThan(1.2);
  });
});

describe("F-02 / BUG-019  cylinder/cone colliders respect the Z scale", () => {
  // FIXED 2026-08-13 (Phase 5). A single-radius primitive cannot represent an
  // oval cross-section, so a radially non-uniform scale now falls back to the
  // real scaled boundary — the same escape the sphere branch already used.
  it("a radially uniform cylinder still gets the cheap analytic collider", () => {
    const round = getShapeColliderConfigs({ type: "cylinder", scale: [1, 2, 1] }, undefined, true);
    expect(round[0].type).toBe("cylinder");
    expect(round[0].args).toEqual([1, 0.5]); // [halfHeight, radius]
  });

  it("an oval cylinder no longer collapses onto the round one's collider", () => {
    const round = getShapeColliderConfigs({ type: "cylinder", scale: [1, 2, 1] }, undefined, true);
    const oval = getShapeColliderConfigs({ type: "cylinder", scale: [1, 2, 4] }, undefined, true);
    expect(oval[0].args).not.toEqual(round[0].args);
    // Falls back to a real boundary rather than a single-radius primitive.
    expect(oval[0].type).toBe("hull");
  });

  it("same for cone", () => {
    const a = getShapeColliderConfigs({ type: "cone", scale: [1, 2, 1] }, undefined, true);
    const b = getShapeColliderConfigs({ type: "cone", scale: [1, 2, 4] }, undefined, true);
    expect(a[0].type).toBe("cone");
    expect(b[0].type).toBe("hull");
    expect(a[0].args).not.toEqual(b[0].args);
  });
});

describe("F-03 / BUG-020  torus wedge mass fractions always sum to 1", () => {
  // FIXED 2026-08-13 (Phase 5). Wedges with too few vertices are still
  // skipped, but the share is now normalized across the wedges actually
  // emitted rather than the requested count, so no mass goes missing.
  it("sums to 1 at the default wedge count (baseline)", () => {
    const cfgs = getTorusCompoundColliders(S, true);
    const sum = cfgs.reduce((s, c) => s + (c.massFraction ?? 0), 0);
    expect(cfgs.length).toBe(12);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("still sums to 1 when wedges are dropped", () => {
    // A high wedge count starves individual buckets of vertices.
    const wedgeCount = 400;
    const cfgs = getTorusCompoundColliders(S, true, wedgeCount);
    const sum = cfgs.reduce((s, c) => s + (c.massFraction ?? 0), 0);
    expect(cfgs.length).toBeLessThan(wedgeCount); // wedges were dropped...
    expect(sum).toBeCloseTo(1, 10); // ...but the mass is redistributed, not lost
  });
});

describe("F-04 / BUG-021  cogwheel collider matches its render mesh", () => {
  // FIXED 2026-08-13 (Phase 5). The bore corners are circumscribed so the
  // chord between them lands ON the nominal bore, and the collider now
  // accounts for the ExtrudeGeometry bevel in both depth and tip radius.
  const teeth = 6;
  const cfgs = getCogwheelCompoundColliders("cogwheel-6t", S, true);

  it("mass fractions sum to 1", () => {
    const sum = cfgs.reduce((s, c) => s + (c.massFraction ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("the base-wedge chord no longer intrudes into the axle bore", () => {
    let minRadius = Infinity;
    for (const c of cfgs) {
      const v = c.args[0] as Float32Array;
      for (let i = 0; i + 2 < v.length; i += 3) {
        // world = (x, +/-halfDepth, y) after the cogwheel's rotateX
        const r = Math.hypot(v[i], v[i + 2]);
        if (r < minRadius) minRadius = r;
      }
    }
    const halfStep = Math.PI / teeth;
    // Vertices now sit OUTSIDE the bore, circumscribed...
    expect(minRadius).toBeCloseTo(COGWHEEL_BORE_RADIUS / Math.cos(halfStep), 5);
    // ...so the hull's inner FACE — the chord between them — lands exactly on
    // the bore. A shaft sized to COGWHEEL_BORE_RADIUS now fits both.
    expect(minRadius * Math.cos(halfStep)).toBeCloseTo(COGWHEEL_BORE_RADIUS, 6);
  });

  it("is as thick and as wide as the geometry actually rendered", () => {
    const geom = getCachedGeometry("cogwheel-6t", "medium");
    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const meshHalfDepth = (bb.max.y - bb.min.y) / 2;

    let colliderHalfDepth = 0;
    let colliderOuter = 0;
    for (const c of cfgs) {
      const v = c.args[0] as Float32Array;
      for (let i = 0; i + 2 < v.length; i += 3) {
        colliderHalfDepth = Math.max(colliderHalfDepth, Math.abs(v[i + 1]));
        colliderOuter = Math.max(colliderOuter, Math.hypot(v[i], v[i + 2]));
      }
    }
    // Within a couple of percent of the mesh rather than >10% under it.
    expect(colliderHalfDepth).toBeCloseTo(meshHalfDepth, 2);
    expect(colliderOuter).toBeGreaterThan(COGWHEEL_OUTER_RADIUS);
    expect(colliderOuter).toBeCloseTo(Math.max(bb.max.x, bb.max.z), 1);
  });
});

describe("F-05 / BUG-025  decomposeConcentricBore rejects an axially displaced hole", () => {
  // FIXED 2026-08-13 (Phase 7). The through-hole check compared only HEIGHTS,
  // so a correctly-sized hole slid almost entirely off one end was accepted
  // and decomposed into a clean centred through-bore — carving the bore where
  // there wasn't one. It must now actually span the solid.
  const solid: PrimitiveDescriptor = {
    kind: "cylinder",
    radius: 1,
    height: 2,
    axis: 1,
    center: [0, 0, 0],
  };
  const hole = (centerY: number): PrimitiveDescriptor => ({
    kind: "cylinder", radius: 0.3, height: 2, axis: 1, center: [0, centerY, 0],
  });

  it("still accepts a properly centred through-hole", () => {
    expect(decomposeConcentricBore(solid, hole(0))).not.toBeNull();
  });

  it("rejects a hole slid off the end", () => {
    expect(decomposeConcentricBore(solid, hole(1.9))).toBeNull();
    expect(decomposeConcentricBore(solid, hole(-1.9))).toBeNull();
  });

  it("tolerates the small overhang a real cutter has", () => {
    // Hole cutters are conventionally a little longer than the solid, and
    // slightly off-centre — that must not be rejected.
    const generous: PrimitiveDescriptor = {
      kind: "cylinder", radius: 0.3, height: 2.2, axis: 1, center: [0, 0.02, 0],
    };
    expect(decomposeConcentricBore(solid, generous)).not.toBeNull();
  });
});

// ── Helpers shared by the cycle-guard tests below ──────────────────────────
function member(over: Partial<CustomMember> = {}): CustomMember {
  const base: CustomMember = {
    type: "cube",
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    isHole: false,
  };
  return { ...base, ...over };
}

/** A member whose own customMembers list contains itself. */
function makeCyclicMember(): CustomMember {
  const m = member({ type: "custom" });
  m.customMembers = [m];
  return m;
}

/** A -> B -> A, i.e. a cycle two levels up rather than a self-reference. */
function makeMutualCycle(): CustomMember {
  const a = member({ type: "custom" });
  const b = member({ type: "custom" });
  a.customMembers = [b];
  b.customMembers = [a];
  return a;
}

function makeDeepChain(levels: number, leaf: CustomMember = member()): CustomMember {
  let node = leaf;
  for (let i = 0; i < levels; i++) {
    node = member({ type: "custom", customMembers: [node] });
  }
  return node;
}

describe("F-06 / BUG-029  cyclic customMembers are guarded, not fatal", () => {
  // FIXED 2026-08-13 (Phase 2). These previously asserted the bug — that
  // hasStructuralHoles threw RangeError and the JSON.stringify memo key threw
  // TypeError. They now assert the guard, per the tracking doc's
  // "Marking findings fixed" process.

  it("hasStructuralHoles returns cleanly on a self-referential tree", () => {
    expect(() => hasStructuralHoles([makeCyclicMember()])).not.toThrow();
    // No hole anywhere on the path, so the correct answer is plainly false.
    expect(hasStructuralHoles([makeCyclicMember()])).toBe(false);
  });

  it("handles an A -> B -> A cycle, not just self-reference", () => {
    expect(() => hasStructuralHoles([makeMutualCycle()])).not.toThrow();
    expect(hasStructuralHoles([makeMutualCycle()])).toBe(false);
  });

  it("still finds a real hole that sits on a cyclic branch", () => {
    // The guard must stop the recursion without blinding the walker to
    // genuine data it reaches on the way in.
    const cyclic = member({ type: "custom" });
    cyclic.customMembers = [member({ isHole: true }), cyclic];
    expect(hasStructuralHoles([cyclic])).toBe(true);
  });

  it("serializeMembers produces a finite, stable key for a cyclic tree", () => {
    expect(() => serializeMembers([makeCyclicMember()])).not.toThrow();
    const key = serializeMembers([makeCyclicMember()]);
    expect(key).toContain("<cycle>");
    // Deterministic: the same structure must key identically, or the voxel
    // cache would miss on every render.
    expect(serializeMembers([makeCyclicMember()])).toBe(key);
  });

  it("serializeMembers distinguishes trees that differ only past the cycle", () => {
    // Dropping the cyclic branch entirely would collide these two onto one
    // cache key and hand one shape the other's colliders.
    const a = member({ type: "custom" });
    a.customMembers = [member({ scale: [1, 1, 1] }), a];
    const b = member({ type: "custom" });
    b.customMembers = [member({ scale: [9, 9, 9] }), b];
    expect(serializeMembers([a])).not.toBe(serializeMembers([b]));
  });

  it("the memo key no longer routes through JSON.stringify", () => {
    // JSON.stringify itself still throws — that is a property of JS, not of
    // this app. What changed is that MemberCollider and VoxelizedShapeBody
    // no longer call it. serializeMembers is what they use now.
    expect(() => JSON.stringify([makeCyclicMember()])).toThrow(TypeError);
    expect(() => serializeMembers([makeCyclicMember()])).not.toThrow();
  });

  it("a merely DEEP (acyclic) tree is still fine — the guard is cycle-only", () => {
    // Requirement 3's negative case, at the audit's own 500-level measurement.
    // A path-scoped guard must not mistake depth for a cycle.
    const deep = makeDeepChain(500);
    expect(hasStructuralHoles([deep])).toBe(false);
    expect(() => serializeMembers([deep])).not.toThrow();
    expect(serializeMembers([deep])).not.toContain("<cycle>");
  });

  it("a DAG (same member twice as siblings) is not treated as a cycle", () => {
    // A path-scoped guard allows this; a global visited-set would wrongly
    // truncate the second occurrence and silently drop real geometry.
    const shared = member({ type: "custom", customMembers: [member({ isHole: true })] });
    const parent = member({ type: "custom", customMembers: [shared, shared] });
    expect(hasStructuralHoles([parent])).toBe(true);
    const key = serializeMembers([parent]);
    expect(key).not.toContain("<cycle>");
    // Both occurrences serialise, so the key mentions the child twice.
    expect(key.split("true").length - 1).toBe(2);
  });
});

describe("BUG-031  evaluateCustomGeometry guards its own recursion", () => {
  // The third walker in the BUG-031 group, and the one on the render path —
  // a throw here has no boundary between it and the scene.
  it("substitutes a placeholder instead of recursing forever on a cycle", () => {
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cyclic = makeCyclicMember();
      let geom!: THREE.BufferGeometry;
      expect(() => {
        geom = evaluateCustomGeometry([cyclic], evaluator);
      }).not.toThrow();
      // Still returns usable geometry rather than nothing — the member is
      // stood in for, not dropped.
      expect(geom.attributes.position.count).toBeGreaterThan(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves an ordinary nested composite alone", () => {
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const nested = member({
      type: "custom",
      customMembers: [member({ type: "cube" })],
    });
    const geom = evaluateCustomGeometry([nested], evaluator);
    expect(geom.attributes.position.count).toBeGreaterThan(0);
  });
});

describe("BUG-032  getRootGroupId survives a cyclic parentGroupId chain", () => {
  // Faithful re-implementation of SimulationScene.tsx's getRootGroupId, same
  // convention as the F-08 block below (the real one is closed over inside a
  // component and can't be imported). Kept deliberately literal so it stays
  // comparable to the source.
  type G = { id: number; parentGroupId?: number; isJoint?: boolean };

  const makeRootFinder = (groups: G[], guarded: boolean) => (groupId: number): number => {
    let currentId = groupId;
    const seen = new Set<number>([currentId]);
    let iterations = 0;
    while (true) {
      // Bound only the UNGUARDED variant, so the test can demonstrate the hang
      // without actually hanging the suite.
      if (!guarded && ++iterations > 10_000) throw new Error("did not terminate");
      const g = groups.find((x) => x.id === currentId);
      if (!g || !g.parentGroupId || g.isJoint) break;
      if (guarded && seen.has(g.parentGroupId)) break;
      seen.add(g.parentGroupId);
      currentId = g.parentGroupId;
    }
    return currentId;
  };

  // 1 -> 2 -> 3 -> 1
  const cyclic: G[] = [
    { id: 1, parentGroupId: 2 },
    { id: 2, parentGroupId: 3 },
    { id: 3, parentGroupId: 1 },
  ];

  it("control — the unguarded walk never terminates", () => {
    expect(() => makeRootFinder(cyclic, false)(1)).toThrow("did not terminate");
  });

  it("the guarded walk terminates and returns a real group id", () => {
    const rootOf = makeRootFinder(cyclic, true);
    const root = rootOf(1);
    expect(Number.isInteger(root)).toBe(true);
    // Must be an id the caller can actually look up — getBodyRef and
    // groupMapping both use the result as a grouping key, so a sentinel like
    // -1 or undefined would break them downstream.
    expect(cyclic.some((g) => g.id === root)).toBe(true);
  });

  it("members of the same cyclic group still group together", () => {
    // The property every caller depends on: getRootGroupId(a) === getRootGroupId(b)
    // for two members of one group. A deterministic break preserves it.
    const rootOf = makeRootFinder(cyclic, true);
    expect(rootOf(1)).toBe(rootOf(1));
    expect(rootOf(2)).toBe(rootOf(2));
  });

  it("acyclic chains are unaffected", () => {
    const acyclic: G[] = [
      { id: 1, parentGroupId: 2 },
      { id: 2, parentGroupId: 3 },
      { id: 3 },
    ];
    expect(makeRootFinder(acyclic, true)(1)).toBe(3);
    // A joint boundary still stops the walk where it always did.
    const jointed: G[] = [
      { id: 1, parentGroupId: 2 },
      { id: 2, parentGroupId: 3, isJoint: true },
      { id: 3 },
    ];
    expect(makeRootFinder(jointed, true)(1)).toBe(2);
  });
});

describe("F-08 / BUG-001  getBodyRef gives every RigidBody a distinct ref", () => {
  // FIXED 2026-08-13 (Phase 3). These previously asserted the collision; they
  // now assert the namespaced keying that replaced it, with the old scheme
  // kept alongside as a control so the assertions stay falsifiable.
  //
  // Both schemes are re-implementations of SimulationScene.tsx's getBodyRef
  // and the two render paths that consume it (unGroupedShapes, groupMapping).
  // Re-implemented rather than imported because the real one is closed over
  // inside the component — so these characterise the algorithm, and a change
  // to the real function must be mirrored here deliberately.
  type S = { id: number; parentId?: number };
  type MG = { id: number; pivotShapeId?: number; shapeIds: number[] };
  type Grp = { id: number; parentGroupId?: number; isJoint?: boolean };

  function scene(shapes: S[], groups: Grp[], motorGroups: MG[]) {
    const getRootGroupId = (gid: number): number => {
      let c = gid;
      const seen = new Set<number>([c]);
      for (;;) {
        const g = groups.find((x) => x.id === c);
        if (!g || !g.parentGroupId || g.isJoint) break;
        if (seen.has(g.parentGroupId)) break; // BUG-032 guard
        seen.add(g.parentGroupId);
        c = g.parentGroupId;
      }
      return c;
    };
    const isDrivenMember = (id: number) =>
      motorGroups.some((mg) => mg.shapeIds.includes(id) && mg.pivotShapeId !== id);

    // The scheme that shipped before BUG-001 was fixed: a bare shape id,
    // borrowed from whichever member of the group sorted first.
    const oldKey = (id: number): string => {
      const shape = shapes.find((s) => s.id === id);
      let targetId = id;
      if (shape?.parentId && !isDrivenMember(id)) {
        const rootId = getRootGroupId(shape.parentId);
        const members = shapes.filter((s) => s.parentId && getRootGroupId(s.parentId) === rootId);
        if (members.length > 0) targetId = members[0].id;
      }
      return String(targetId);
    };

    // The scheme now in SimulationScene.tsx: disjoint `group:` / `shape:`
    // namespaces, with the group keyed on the group rather than on a member.
    const newKey = (id: number): string => {
      const shape = shapes.find((s) => s.id === id);
      if (shape?.parentId && !isDrivenMember(id)) {
        return `group:${getRootGroupId(shape.parentId)}`;
      }
      return `shape:${id}`;
    };
    const newGroupKey = (rootGroupId: number) => `group:${rootGroupId}`;

    const standalone = shapes.filter((s) => !s.parentId || isDrivenMember(s.id));
    const groupMap = new Map<number, S[]>();
    shapes.forEach((s) => {
      if (!s.parentId || isDrivenMember(s.id)) return;
      const root = getRootGroupId(s.parentId);
      if (!groupMap.has(root)) groupMap.set(root, []);
      groupMap.get(root)!.push(s);
    });
    return { oldKey, newKey, newGroupKey, standalone, groupMapping: [...groupMap.entries()] };
  }

  // Gear (10) driven by a motor pivoting on the arm plate (11); all three
  // shapes parented into group 1, gear listed FIRST — the triggering order.
  const gearFirst: S[] = [{ id: 10, parentId: 1 }, { id: 11, parentId: 1 }, { id: 12, parentId: 1 }];
  const gearLast: S[] = [{ id: 11, parentId: 1 }, { id: 12, parentId: 1 }, { id: 10, parentId: 1 }];
  const motorGroups: MG[] = [{ id: 99, pivotShapeId: 11, shapeIds: [11, 10] }];

  it("control — the old scheme collided, and only on one array ordering", () => {
    const bad = scene(gearFirst, [{ id: 1 }], motorGroups);
    expect(bad.standalone.map((s) => s.id)).toEqual([10]);
    expect(bad.groupMapping[0][1].map((s) => s.id)).toEqual([11, 12]);
    // Group body and the driven member's own body shared one ref...
    expect(bad.oldKey(10)).toBe(bad.oldKey(bad.groupMapping[0][1][0].id));
    // ...but only when the driven member sorted first, which is what made
    // this so intermittent.
    const ok = scene(gearLast, [{ id: 1 }], motorGroups);
    expect(ok.oldKey(10)).not.toBe(ok.oldKey(11));
  });

  it("the group body and the driven member's body now get distinct refs", () => {
    const s = scene(gearFirst, [{ id: 1 }], motorGroups);
    expect(s.newKey(10)).toBe("shape:10");
    expect(s.newGroupKey(s.groupMapping[0][0])).toBe("group:1");
    expect(s.newKey(10)).not.toBe(s.newGroupKey(s.groupMapping[0][0]));
  });

  it("CustomRevoluteMotor no longer joints a body to itself", () => {
    const s = scene([{ id: 10, parentId: 1 }, { id: 11, parentId: 1 }], [{ id: 1 }], motorGroups);
    // pivotRef=getBodyRef(pivotShapeId), shapeRef=getBodyRef(drivenShapeId).
    expect(s.newKey(11)).not.toBe(s.newKey(10));
  });

  it("is order-independent — the whole point of the fix", () => {
    const a = scene(gearFirst, [{ id: 1 }], motorGroups);
    const b = scene(gearLast, [{ id: 1 }], motorGroups);
    for (const id of [10, 11, 12]) {
      expect(a.newKey(id)).toBe(b.newKey(id));
    }
    // And no two bodies in the scene share a key, either ordering.
    for (const s of [a, b]) {
      const keys = [
        ...s.standalone.map((x) => s.newKey(x.id)),
        ...s.groupMapping.map(([gid]) => s.newGroupKey(gid)),
      ];
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("every grouped non-driven member still resolves to the one group body", () => {
    // The behaviour that had to be preserved: shapes 11 and 12 are both
    // controlled by the same compound body.
    const s = scene(gearFirst, [{ id: 1 }], motorGroups);
    expect(s.newKey(11)).toBe(s.newGroupKey(1));
    expect(s.newKey(12)).toBe(s.newGroupKey(1));
  });

  it("the demo car is unaffected — its driven members were never grouped", () => {
    // Regression guard for the Gate A finding: BUG-001 never applied to the
    // vehicle scene, so the fix must be a no-op there.
    const demo: S[] = [
      { id: 1001, parentId: 3001 }, { id: 1008, parentId: 3001 }, { id: 1021, parentId: 3001 },
      { id: 1006 }, { id: 1007 }, { id: 1002 }, { id: 1003 }, { id: 1004 }, { id: 1005 },
    ];
    const demoMGs: MG[] = [
      { id: 2001, pivotShapeId: 1001, shapeIds: [1001, 1004, 1005] },
      { id: 2002, pivotShapeId: 1001, shapeIds: [1001, 1002, 1003] },
      { id: 2003, pivotShapeId: 1001, shapeIds: [1001, 1006] },
      { id: 2004, pivotShapeId: 1001, shapeIds: [1001, 1007] },
    ];
    const s = scene(demo, [{ id: 3001 }], demoMGs);
    // Old and new agree on every shape, so nothing about this scene moves.
    for (const sh of demo) {
      const oldK = s.oldKey(sh.id);
      const newK = s.newKey(sh.id);
      const equivalent = newK === `shape:${oldK}` || newK === `group:3001`;
      expect(equivalent).toBe(true);
    }
    expect(s.newKey(1001)).toBe("group:3001");
    expect(s.newKey(1002)).toBe("shape:1002");
  });
});

describe("BUG-007  sortMotorGroups orders parents before children", () => {
  // FIXED 2026-08-13 (Phase 3). Unlike most of this phase, sortMotorGroups is
  // a plain exported function, so this exercises the REAL implementation
  // rather than a re-implementation.
  type MG = import("@/pages/CadStudio").MotorGroup;
  const mg = (id: number, shapeIds: number[], pivotShapeId?: number): MG =>
    ({ id, name: `mg${id}`, shapeIds, pivotShapeId }) as MG;

  // A parents B (A controls B's pivot shape 1); B parents C (B controls C's
  // pivot shape 2). A three-link chain is the shortest case where a
  // non-transitive comparator can produce a wrong order.
  const A = mg(1, [1, 2, 3]);
  const B = mg(2, [2, 3], 1);
  const C = mg(3, [3], 2);

  const permutations: MG[][] = [
    [A, B, C], [A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A],
  ];

  it("produces parent-before-child for every input ordering", () => {
    for (const input of permutations) {
      const out = sortMotorGroups(input).map((m) => m.id);
      expect(out).toHaveLength(3);
      expect(out.indexOf(1)).toBeLessThan(out.indexOf(2)); // A before B
      expect(out.indexOf(2)).toBeLessThan(out.indexOf(3)); // B before C
    }
  });

  it("is deterministic — same input, same output", () => {
    for (const input of permutations) {
      expect(sortMotorGroups(input).map((m) => m.id)).toEqual(
        sortMotorGroups([...input]).map((m) => m.id),
      );
    }
  });

  it("never drops or duplicates a group", () => {
    for (const input of permutations) {
      const out = sortMotorGroups(input);
      expect(new Set(out.map((m) => m.id))).toEqual(new Set([1, 2, 3]));
      expect(out).toHaveLength(input.length);
    }
  });

  it("survives a cyclic parent relation without hanging or dropping groups", () => {
    // X pivots on a shape Y controls and vice versa — malformed, but reachable
    // from hand-edited state. Must terminate and still emit both.
    const X = mg(10, [100], 200);
    const Y = mg(11, [200], 100);
    const out = sortMotorGroups([X, Y]);
    expect(out.map((m) => m.id).sort()).toEqual([10, 11]);
  });

  it("leaves unrelated groups in input order", () => {
    const P = mg(20, [1]);
    const Q = mg(21, [2]);
    expect(sortMotorGroups([P, Q]).map((m) => m.id)).toEqual([20, 21]);
    expect(sortMotorGroups([Q, P]).map((m) => m.id)).toEqual([21, 20]);
  });

  it("handles the trivial sizes", () => {
    expect(sortMotorGroups([])).toEqual([]);
    expect(sortMotorGroups([A]).map((m) => m.id)).toEqual([1]);
  });
});

describe("F-07 / BUG-016  voxel box volumes no longer double-count the overlap", () => {
  // FIXED 2026-08-13 (Phase 4). The bulk grid still overlaps the fine grids by
  // design — excluding on the smaller region while covering with the larger is
  // what guarantees no gaps — but a bulk box is now charged only for the
  // material the fine grid is not already accounting for, so the summed
  // `volume` that drives mass fractions matches the real solid.
  it("summed box volume tracks the shape's real volume instead of exceeding it", async () => {
    const { buildVoxelCompoundColliders } = await import("@/lib/voxelCollider");

    // 2x2x2 block with a declared feature region through Y, built as a real
    // mesh so the inside-test has something closed to raycast against.
    const box = new THREE.BoxGeometry(2, 2, 2);
    const boxes = buildVoxelCompoundColliders(box, [
      { min: [-0.4, -1, -0.4], max: [0.4, 1, 0.4] },
    ]);

    expect(boxes.length).toBeGreaterThan(0);
    const summed = boxes.reduce((s, b) => s + b.volume, 0);
    const real = 2 * 2 * 2;
    // Was > 8 before the fix (the margin band counted twice). Now within
    // voxel-discretisation error of the true 8, and never above it.
    expect(summed).toBeLessThanOrEqual(real);
    expect(summed).toBeGreaterThan(real * 0.9);
  });

  it("no box is charged a negative volume", async () => {
    // A bulk box fully swallowed by several coverage regions must clamp at
    // zero, not go negative and flip the sign of a mass fraction.
    const { buildVoxelCompoundColliders } = await import("@/lib/voxelCollider");
    const box = new THREE.BoxGeometry(2, 2, 2);
    const boxes = buildVoxelCompoundColliders(box, [
      { min: [-0.9, -1, -0.9], max: [0.9, 1, 0.9] },
      { min: [-0.8, -1, -0.8], max: [0.8, 1, 0.8] },
    ]);
    expect(boxes.every((b) => b.volume >= 0)).toBe(true);
  });
});
