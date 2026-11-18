import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Evaluator } from "three-bvh-csg";
import type { CustomMember } from "@/pages/CadStudio";
import { evaluateCustomGeometry, getCogwheelToothProfile, COGWHEEL_INNER_RADIUS, COGWHEEL_OUTER_RADIUS, COGWHEEL_BORE_RADIUS, COGWHEEL_DEPTH } from "@/components/canvas/utils/geometryHelpers";
import { getCachedGeometry } from "@/lib/geometryCache";
import {
  decomposeConcentricBore,
  resolveCylinderParams,
  otherAxes,
  CONCENTRICITY_TOLERANCE,
  THROUGH_HOLE_TOLERANCE,
  CYLINDER_RADIAL_ASPECT_TOLERANCE,
  CYLINDER_VOLUME_FILL_TOLERANCE,
  tryBuildUpsampledCylinderDescriptor,
  type PrimitiveDescriptor,
} from "@/lib/concentricBoreDecomposition";
import { decomposeBoundaryFollowingBore, type BoundaryFollowingBoreConfig } from "@/lib/boundaryFollowingBoreDecomposition";
import { meshVolume } from "@/lib/hollowShapeVoxelization";

// Dry-run coverage survey (read-only measurement, not a correctness test):
// how often would decomposeConcentricBore (Tier 1a) / decomposeBoundaryFollowingBore
// (Tier 1b) actually serve real, already-built-in-the-app shapes vs. fall
// back to Tier 2 (voxel-box)? Neither decomposer is modified or wired into
// any live path by this file. See the accompanying plan doc for the full
// design rationale.

// ---------------------------------------------------------------------------
// Sample shape data — copied verbatim from CadStudio.tsx's addShape()
// (lines ~1942-2118 at the time of writing), since that function is a
// closure inside the component, not an exported data table. Keep these in
// sync manually if the presets change.
// ---------------------------------------------------------------------------

const PIPE_MEMBERS: CustomMember[] = [
  { type: "cylinder", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
  { type: "cylinder", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0.75, 1.1, 0.75], isHole: true },
];

const ARCH_MEMBERS: CustomMember[] = [
  { type: "cube", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1.2, 0.4], isHole: false },
  { type: "cylinder", offset: [0, -0.2, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.6, 1, 0.6], isHole: true },
  { type: "cube", offset: [0, -0.5, 0], rotation: [0, 0, 0], scale: [0.6, 0.6, 1], isHole: true },
];

const BOWL_MEMBERS: CustomMember[] = [
  { type: "sphere", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
  { type: "sphere", offset: [0, 0.1, 0], rotation: [0, 0, 0], scale: [0.85, 0.85, 0.85], isHole: true },
  { type: "cube", offset: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1.2, 1, 1.2], isHole: true },
];

// Real cogwheel profile, reconstructed WITHOUT the shape.holes subtraction
// (see createCogWheelGeometry in geometryHelpers.ts) so we get the bare
// solid to test against the real, known bore radius separately — the
// in-app cogwheel bakes its bore into a single mesh via shape.holes, never
// as an isHole CustomMember, so it doesn't fit the isHole-tree pattern the
// two tiers below were built for. Included anyway (clearly labeled) since
// it's the only other real hole-bearing asset in the app.
function buildCogwheelSolidGeometry(teeth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const angleStep = (2 * Math.PI) / teeth;
  for (let i = 0; i < teeth; i++) {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = getCogwheelToothProfile(teeth, i);
    if (i === 0) shape.moveTo(x0, y0);
    else shape.lineTo(x0, y0);
    shape.lineTo(x1, y1);
    shape.lineTo(x2, y2);
    shape.lineTo(x3, y3);
  }
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: COGWHEEL_DEPTH,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.015,
    bevelThickness: 0.015,
  });
  geom.center();
  geom.rotateX(Math.PI / 2);
  return geom;
}

type SampleShape = {
  id: string;
  note: string;
  members: CustomMember[]; // passed to Tier 1b as solidMembers, and merged (solids-only) for Tier 1a
  holeDescriptor: PrimitiveDescriptor;
  gltfMap?: Map<string, THREE.BufferGeometry>;
};

function buildSamples(): SampleShape[] {
  const samples: SampleShape[] = [];

  samples.push({
    id: "pipe",
    note: "1 solid cylinder + 1 concentric on-axis hole (cleanest real case)",
    members: PIPE_MEMBERS,
    holeDescriptor: memberToMeshDescriptor(PIPE_MEMBERS[1]),
  });

  samples.push({
    id: "arch-full",
    note: "1 solid cube + 2 holes as authored (cylindrical rotated 90°, + a non-circular cube hole)",
    members: ARCH_MEMBERS,
    holeDescriptor: memberToMeshDescriptor(ARCH_MEMBERS[1]),
  });
  samples.push({
    id: "arch-isolated",
    note: "same as arch-full but with the non-circular cube hole dropped, isolating the cylindrical hole",
    members: [ARCH_MEMBERS[0], ARCH_MEMBERS[1]],
    holeDescriptor: memberToMeshDescriptor(ARCH_MEMBERS[1]),
  });

  samples.push({
    id: "bowl-full",
    note: "1 solid sphere + 2 holes as authored (both non-circular: spherical + cube)",
    members: BOWL_MEMBERS,
    holeDescriptor: memberToMeshDescriptor(BOWL_MEMBERS[1]),
  });
  samples.push({
    id: "bowl-isolated",
    note: "same as bowl-full but with the cube hole dropped, isolating the (still non-circular) spherical hole",
    members: [BOWL_MEMBERS[0], BOWL_MEMBERS[1]],
    holeDescriptor: memberToMeshDescriptor(BOWL_MEMBERS[1]),
  });

  for (const teeth of [6, 8, 12, 16]) {
    const url = `synthetic://cogwheel-${teeth}t`;
    const gltfMap = new Map<string, THREE.BufferGeometry>([[url, buildCogwheelSolidGeometry(teeth)]]);
    const members: CustomMember[] = [
      { type: "glb", url, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
    ];
    samples.push({
      id: `cogwheel-${teeth}t`,
      note: "real in-app tooth profile; bore is baked into the mesh in-app (shape.holes), not an isHole CustomMember — supplied externally here, same convention as a GLB solid+hole pair",
      members,
      holeDescriptor: { kind: "cylinder", radius: COGWHEEL_BORE_RADIUS, height: COGWHEEL_DEPTH * 1.5, axis: 1, center: [0, 0, 0] },
      gltfMap,
    });
  }

  return samples;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function bufferGeometryToMeshDescriptor(geom: THREE.BufferGeometry): PrimitiveDescriptor {
  const positions = new Float32Array(geom.attributes.position.array);
  let indices: Uint32Array;
  if (geom.index) {
    indices = new Uint32Array(geom.index.array);
  } else {
    indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  return { kind: "mesh", positions, indices };
}

// evaluateCustomGeometry always filters out isHole members (even in
// additionOnly mode), so it can't be reused to extract a hole member's own
// geometry — this mirrors its internal per-member transform (offset/
// rotation/scale compose), applied to a single member in isolation.
//
// Native "cylinder" members go through tryBuildUpsampledCylinderDescriptor
// first (32-segment fit-only rebuild — see concentricBoreDecomposition.ts)
// instead of the app's shared 16-segment render cache (getCachedGeometry),
// fixing the near-miss this survey originally found. Every other member
// type is unaffected, falling through to the same path as before.
function memberToMeshDescriptor(member: CustomMember, gltfMap?: Map<string, THREE.BufferGeometry>): PrimitiveDescriptor {
  const upsampled = tryBuildUpsampledCylinderDescriptor(member);
  if (upsampled) return upsampled;

  let geom: THREE.BufferGeometry;
  if (member.type === "glb" && member.url && gltfMap?.has(member.url)) {
    geom = gltfMap.get(member.url)!.clone();
  } else {
    geom = getCachedGeometry(member.type, "medium").clone();
  }
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...member.offset),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...member.rotation)),
    new THREE.Vector3(...member.scale),
  );
  geom.applyMatrix4(matrix);
  return bufferGeometryToMeshDescriptor(geom);
}

// For Tier 1a's solid: if solidMembers reduces to exactly one non-hole
// member and it's a native cylinder, skip the CSG merge entirely and use
// the same upsampled descriptor the hole path uses — no merge is needed
// for a single primitive, and this is exactly the case (pipe) the fix
// targets. Every other shape (multi-member, or a non-cylinder single
// member) falls through to the existing CSG-merge path, unaffected.
function mergedSolidDescriptor(members: CustomMember[], evaluator: Evaluator, gltfMap?: Map<string, THREE.BufferGeometry>): PrimitiveDescriptor {
  const solids = members.filter((m) => !m.isHole);
  if (solids.length === 1) {
    const upsampled = tryBuildUpsampledCylinderDescriptor(solids[0]);
    if (upsampled) return upsampled;
  }

  const geom = evaluateCustomGeometry(members, evaluator, gltfMap, undefined, true);
  const desc = bufferGeometryToMeshDescriptor(geom);
  geom.dispose();
  return desc;
}

function mergedSolidsBBox(members: CustomMember[], evaluator: Evaluator, gltfMap?: Map<string, THREE.BufferGeometry>) {
  const geom = evaluateCustomGeometry(members, evaluator, gltfMap, undefined, true);
  geom.computeBoundingBox();
  const bbox = geom.boundingBox!;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  geom.dispose();
  return { size, center, isEmpty: bbox.isEmpty() };
}

// ---------------------------------------------------------------------------
// Rejection-reason classification
// ---------------------------------------------------------------------------

// fitCylinderFromMesh only reports deviation numbers on SUCCESS — on
// failure it just returns null. For a "not recognized as a cylinder"
// verdict, re-running its own best-axis scoring (without the tolerance
// gate) tells us whether the mesh is a near-miss (a real cylinder at too
// coarse a facet count for the tolerance) or genuinely not cylindrical —
// a distinction that matters a lot for the report (see the pipe finding).
function bestCylinderFitDiagnostic(positions: Float32Array, indices?: Uint32Array): string {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  const actualVolume = meshVolume(positions, indices);
  if (actualVolume <= 0) return "degenerate mesh (zero volume)";

  let best: { axis: number; radialAspectDeviation: number; volumeFillDeviation: number } | null = null;
  for (const axis of [0, 1, 2]) {
    const [a, b] = otherAxes(axis as 0 | 1 | 2);
    const diamA = size[a], diamB = size[b], height = size[axis];
    if (diamA <= 0 || diamB <= 0 || height <= 0) continue;
    const radialAspectDeviation = Math.abs(diamA - diamB) / Math.max(diamA, diamB);
    const radius = (diamA + diamB) / 4;
    const idealVolume = Math.PI * radius * radius * height;
    const volumeFillDeviation = Math.abs(actualVolume - idealVolume) / idealVolume;
    const score = radialAspectDeviation + volumeFillDeviation;
    if (!best || score < best.radialAspectDeviation + best.volumeFillDeviation) {
      best = { axis, radialAspectDeviation, volumeFillDeviation };
    }
  }
  if (!best) return "no valid axis candidate";

  const nearMiss =
    best.radialAspectDeviation <= CYLINDER_RADIAL_ASPECT_TOLERANCE * 1.5 &&
    best.volumeFillDeviation <= CYLINDER_VOLUME_FILL_TOLERANCE * 2;
  const qualifier = nearMiss ? "NEAR-MISS — likely just too coarse a facet count, not a shape mismatch" : "not close to cylindrical";
  return `best-axis radialAspectDeviation=${(best.radialAspectDeviation * 100).toFixed(2)}% (tol ${(CYLINDER_RADIAL_ASPECT_TOLERANCE * 100).toFixed(0)}%), volumeFillDeviation=${(best.volumeFillDeviation * 100).toFixed(2)}% (tol ${(CYLINDER_VOLUME_FILL_TOLERANCE * 100).toFixed(0)}%) — ${qualifier}`;
}

function classifyTier1aRejection(solid: PrimitiveDescriptor, hole: PrimitiveDescriptor): string {
  if (solid.kind === "box") return "solid is a box (explicitly out of scope for Tier 1a)";
  const solidParams = resolveCylinderParams(solid);
  if (!solidParams) {
    const diag = solid.kind === "mesh" ? bestCylinderFitDiagnostic(solid.positions, solid.indices as Uint32Array | undefined) : "";
    return `solid not recognized as a cylinder (mesh fit failed)${diag ? " — " + diag : ""}`;
  }
  const holeParams = resolveCylinderParams(hole);
  if (!holeParams) {
    const diag = hole.kind === "mesh" ? bestCylinderFitDiagnostic(hole.positions, hole.indices as Uint32Array | undefined) : "";
    return `non-circular hole${diag ? " — " + diag : ""}`;
  }
  if (solidParams.axis !== holeParams.axis) return "off-axis (hole axis != solid axis)";
  const [a, b] = otherAxes(solidParams.axis);
  const radialOffset = Math.hypot(
    holeParams.center[a] - solidParams.center[a],
    holeParams.center[b] - solidParams.center[b],
  );
  if (radialOffset > CONCENTRICITY_TOLERANCE * solidParams.radius) return "non-concentric";
  if (holeParams.radius <= 0 || holeParams.radius >= solidParams.radius) return "degenerate hole radius";
  if (holeParams.height < solidParams.height * (1 - THROUGH_HOLE_TOLERANCE)) return "blind (non-through) hole";
  return "other";
}

// Mirrors (does not reimplement by import, since these aren't exported as
// reason codes) decomposeBoundaryFollowingBore's own validation chain —
// kept in sync manually. The "budget exceeded" case is instead determined
// empirically (see runTier1b below) rather than duplicated here.
function classifyTier1bStructuralRejection(
  members: CustomMember[],
  hole: PrimitiveDescriptor,
  evaluator: Evaluator,
  gltfMap?: Map<string, THREE.BufferGeometry>,
): string {
  const strayHoleCount = members.filter((m) => m.isHole).length;
  if (strayHoleCount > 1) return "multiple holes present in solidMembers";
  const holeParams = resolveCylinderParams(hole);
  if (!holeParams) {
    const diag = hole.kind === "mesh" ? bestCylinderFitDiagnostic(hole.positions, hole.indices as Uint32Array | undefined) : "";
    return `non-circular hole${diag ? " — " + diag : ""}`;
  }
  const solids = members.filter((m) => !m.isHole);
  if (solids.length === 0) return "no solid members";
  const { size, center, isEmpty } = mergedSolidsBBox(members, evaluator, gltfMap);
  if (isEmpty) return "empty merged solid";
  const [axisA, axisB] = otherAxes(holeParams.axis);
  const estimatedSolidRadius = Math.max(size.getComponent(axisA), size.getComponent(axisB)) / 2;
  if (!(estimatedSolidRadius > 0)) return "degenerate solid radius";
  const radialOffset = Math.hypot(
    holeParams.center[axisA] - center.getComponent(axisA),
    holeParams.center[axisB] - center.getComponent(axisB),
  );
  if (radialOffset > CONCENTRICITY_TOLERANCE * estimatedSolidRadius) return "off-axis / non-concentric";
  if (holeParams.radius <= 0 || holeParams.radius >= estimatedSolidRadius) return "degenerate hole radius";
  const solidHeightAlongAxis = size.getComponent(holeParams.axis);
  if (holeParams.height < solidHeightAlongAxis * (1 - THROUGH_HOLE_TOLERANCE)) return "blind (non-through) hole";
  return "other (raycast miss / open geometry)";
}

// ---------------------------------------------------------------------------
// Survey runner
// ---------------------------------------------------------------------------

type Row = {
  shape: string;
  budget: number;
  tierServed: "1a" | "1b" | "none";
  pieces: number | "";
  timeMs: string;
  rejectionReason: string;
};

const BUDGETS = [128, 200, 256];
const UNCAPPED_CONFIG: BoundaryFollowingBoreConfig = { maxTotalPieces: 100000 };

describe("Tier 1a/1b dry-run coverage survey against real in-app shapes", () => {
  it("runs the survey and prints the report", () => {
    const evaluator = new Evaluator();
    const samples = buildSamples();
    const rows: Row[] = [];
    const alwaysNull: Array<{ shape: string; reason1a: string; reason1b: string }> = [];
    const harnessOverheadMs: Array<{ shape: string; ms: number }> = [];

    for (const sample of samples) {
      const harnessStart = performance.now();

      // Tier 1a: budget-invariant, computed once.
      const solidDescFor1a = mergedSolidDescriptor(sample.members, evaluator, sample.gltfMap);
      const t1aStart = performance.now();
      const result1a = decomposeConcentricBore(solidDescFor1a, sample.holeDescriptor);
      const t1aMs = performance.now() - t1aStart;
      const reason1a = result1a ? "" : classifyTier1aRejection(solidDescFor1a, sample.holeDescriptor);

      let sawAnySuccess = false;
      let lastTier1bReason = "";

      for (const budget of BUDGETS) {
        if (result1a) {
          rows.push({
            shape: sample.id,
            budget,
            tierServed: "1a",
            pieces: result1a.pieces.length,
            timeMs: t1aMs.toFixed(2),
            rejectionReason: "",
          });
          sawAnySuccess = true;
          continue;
        }

        const config: BoundaryFollowingBoreConfig = { maxTotalPieces: budget };
        const result1b = decomposeBoundaryFollowingBore(sample.members, sample.holeDescriptor, evaluator, sample.gltfMap, config);

        if (result1b) {
          rows.push({
            shape: sample.id,
            budget,
            tierServed: "1b",
            pieces: result1b.pieces.length,
            timeMs: result1b.raycastMs.toFixed(2),
            rejectionReason: "",
          });
          sawAnySuccess = true;
        } else {
          // Empirical probe: would an effectively unlimited budget succeed?
          const probe = decomposeBoundaryFollowingBore(sample.members, sample.holeDescriptor, evaluator, sample.gltfMap, UNCAPPED_CONFIG);
          const reason = probe
            ? `budget exceeded (needs ${probe.pieces.length} pieces, ~${probe.raycastMs.toFixed(0)}ms)`
            : classifyTier1bStructuralRejection(sample.members, sample.holeDescriptor, evaluator, sample.gltfMap);
          lastTier1bReason = reason;
          rows.push({
            shape: sample.id,
            budget,
            tierServed: "none",
            pieces: "",
            timeMs: "",
            rejectionReason: reason,
          });
        }
      }

      const harnessMs = performance.now() - harnessStart;
      if (harnessMs > 200) harnessOverheadMs.push({ shape: sample.id, ms: harnessMs });

      if (!sawAnySuccess) {
        alwaysNull.push({ shape: sample.id, reason1a, reason1b: lastTier1bReason });
      }
    }

    // eslint-disable-next-line no-console
    console.table(rows);

    for (const budget of BUDGETS) {
      const atBudget = rows.filter((r) => r.budget === budget);
      const n = atBudget.length;
      const n1a = atBudget.filter((r) => r.tierServed === "1a").length;
      const n1b = atBudget.filter((r) => r.tierServed === "1b").length;
      const nNone = atBudget.filter((r) => r.tierServed === "none").length;
      // eslint-disable-next-line no-console
      console.log(
        `[budget=${budget}] served by 1a: ${n1a}/${n} (${((n1a / n) * 100).toFixed(0)}%), ` +
          `1b: ${n1b}/${n} (${((n1b / n) * 100).toFixed(0)}%), ` +
          `Tier 2 fallback: ${nNone}/${n} (${((nNone / n) * 100).toFixed(0)}%)`,
      );
    }

    // eslint-disable-next-line no-console
    console.log("\n[always fell to Tier 2, all 3 budgets]");
    for (const entry of alwaysNull) {
      // eslint-disable-next-line no-console
      console.log(`  ${entry.shape}: Tier1a → ${entry.reason1a} | Tier1b → ${entry.reason1b}`);
    }

    if (harnessOverheadMs.length > 0) {
      // eslint-disable-next-line no-console
      console.log("\n[harness-only overhead > 200ms — separate from decomposer cost]");
      for (const entry of harnessOverheadMs) {
        // eslint-disable-next-line no-console
        console.log(`  ${entry.shape}: ${entry.ms.toFixed(1)}ms`);
      }
    }

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBe(samples.length * BUDGETS.length);
  });
});
