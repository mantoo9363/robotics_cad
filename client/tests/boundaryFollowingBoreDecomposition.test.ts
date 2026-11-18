import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import * as THREE from "three";
import { Evaluator } from "three-bvh-csg";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { decomposeBoundaryFollowingBore } from "@/lib/boundaryFollowingBoreDecomposition";
import { decomposeConcentricBore, type PrimitiveDescriptor } from "@/lib/concentricBoreDecomposition";
import type { CustomMember } from "@/pages/CadStudio";

function sumVolumes(volumes: number[]): number {
  return volumes.reduce((a, b) => a + b, 0);
}

function loadGlbGeometry(relPath: string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  const buf = fs.readFileSync(path.resolve(process.cwd(), relPath));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(
      ab,
      "",
      (gltf) => {
        let geom: THREE.BufferGeometry | undefined;
        gltf.scene.traverse((n: any) => {
          if (n.isMesh) geom = n.geometry;
        });
        resolve(geom!);
      },
      reject,
    );
  });
}

function makeCylinderMember(
  offset: [number, number, number],
  scale: [number, number, number],
  isHole = false,
): CustomMember {
  return { type: "cylinder", offset, rotation: [0, 0, 0], scale, isHole };
}

function makeBoxMember(offset: [number, number, number], scale: [number, number, number]): CustomMember {
  return { type: "cube", offset, rotation: [0, 0, 0], scale, isHole: false };
}

describe("decomposeBoundaryFollowingBore", () => {
  const evaluator = new Evaluator();

  describe("VALIDATION GATE: plain cylinder solid, compared against decomposeConcentricBore's closed form", () => {
    it("agrees with Tier 1a within 0.1% total volume", async () => {
      // A high-resolution cylinder injected via gltfGeometryMap, not the
      // shared "cylinder" primitive cache (16 segments — its own faceting,
      // ~2.5% area deviation from a true circle, would swamp the 0.1% gate
      // and end up testing mesh resolution instead of the integration
      // math this gate exists to validate).
      const radius = 2, height = 5, segments = 256;
      const highResGeom = new THREE.CylinderGeometry(radius, radius, height, segments);

      const gltfGeometryMap = new Map<string, THREE.BufferGeometry>([
        ["synthetic://high-res-cylinder", highResGeom],
      ]);
      const solidMembers: CustomMember[] = [
        { type: "glb", url: "synthetic://high-res-cylinder", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false },
      ];
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.8, height, axis: 1, center: [0, 0, 0] };

      const boundaryResult = decomposeBoundaryFollowingBore(solidMembers, hole, evaluator, gltfGeometryMap);
      expect(boundaryResult).not.toBeNull();

      const referenceResult = decomposeConcentricBore(
        { kind: "cylinder", radius, height, axis: 1, center: [0, 0, 0] },
        hole,
      );
      expect(referenceResult).not.toBeNull();

      const boundaryTotal = sumVolumes(boundaryResult!.volumes);
      const referenceTotal = sumVolumes(referenceResult!.volumes);
      const relativeDiff = Math.abs(boundaryTotal - referenceTotal) / referenceTotal;

      // eslint-disable-next-line no-console
      console.log(
        `[validation gate] boundary=${boundaryTotal.toFixed(6)} reference=${referenceTotal.toFixed(6)} ` +
          `relativeDiff=${(relativeDiff * 100).toFixed(4)}% pieces=${boundaryResult!.pieces.length} raycastMs=${boundaryResult!.raycastMs.toFixed(2)}`,
      );

      expect(relativeDiff).toBeLessThan(0.001);
      for (const v of boundaryResult!.volumes) expect(v).toBeGreaterThan(0);
    });
  });

  describe("gear (component-12.glb) with a concentric circular bore", () => {
    it("safety-valve engages at default budget: gear's tooth geometry needs far more than 128 pieces / 50ms", async () => {
      const gearGeom = await loadGlbGeometry("public/uploads/component-12.glb");
      gearGeom.computeBoundingBox();
      const bbox = gearGeom.boundingBox!;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // From this session's own instrumentation: component-12.glb's best-
      // fit thickness axis is Y (index 1) — the thin axis, matching a
      // gear's natural bore-through direction.
      const axis: 0 | 1 | 2 = 1;
      const solidRadiusEstimate = Math.max(size.x, size.z) / 2;
      const solidHeight = size.y;

      const gltfGeometryMap = new Map<string, THREE.BufferGeometry>([
        ["synthetic://gear", gearGeom],
      ]);
      const solidMembers: CustomMember[] = [
        {
          type: "glb",
          url: "synthetic://gear",
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isHole: false,
        },
      ];
      const hole: PrimitiveDescriptor = {
        kind: "cylinder",
        radius: solidRadiusEstimate * 0.3, // comfortably smaller than the gear's tooth-root radius
        height: solidHeight * 1.5, // generously through, avoids float-precision edge cases at the boundary
        axis,
        center: [center.x, center.y, center.z],
      };

      // At the DEFAULT config (3% curvature tolerance, 128-piece cap), this
      // correctly returns null — not a bug. Measured separately (uncapped
      // budget) the gear's actual tooth geometry needs 152 pieces and
      // ~115-140ms (varies by run) to satisfy 3% tolerance: 2-3x over the
      // 50ms performance budget this decomposer targets. The 128-piece cap
      // is doing its job here: refusing rather than silently blowing the
      // frame budget on a per-shape one-time build. A toothed gear is
      // exactly the kind of high-frequency boundary this tier isn't meant
      // to absorb — that's what the voxel-box fallback path remains for.
      const result = decomposeBoundaryFollowingBore(solidMembers, hole, evaluator, gltfGeometryMap);
      expect(result).toBeNull();
    });
  });

  describe("box solid with a concentric circular bore", () => {
    it("handles the square-outline case decomposeConcentricBore explicitly punts on", () => {
      const solidMembers: CustomMember[] = [makeBoxMember([0, 0, 0], [4, 5, 4])]; // 4x4 cross-section, height 5
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 1, height: 5, axis: 1, center: [0, 0, 0] };

      const result = decomposeBoundaryFollowingBore(solidMembers, hole, evaluator);
      expect(result).not.toBeNull();
      const { pieces, volumes } = result!;

      expect(pieces.length).toBeGreaterThan(0);
      for (const v of volumes) expect(v).toBeGreaterThan(0);

      // True annulus-in-a-square volume: box volume minus hole cylinder
      // volume (exact, since the box has no other cavities).
      const trueVolume = 4 * 4 * 5 - Math.PI * 1 * 1 * 5;
      const total = sumVolumes(volumes);
      const relativeDiff = Math.abs(total - trueVolume) / trueVolume;

      // eslint-disable-next-line no-console
      console.log(
        `[box+bore] pieces=${pieces.length} total=${total.toFixed(4)} true=${trueVolume.toFixed(4)} relativeDiff=${(relativeDiff * 100).toFixed(3)}%`,
      );

      // Looser than the validation gate on purpose: a square's corners are
      // a genuine kink (continuous value, discontinuous derivative), not a
      // smooth curve — a wedge scheme with a bounded piece budget isn't
      // expected to resolve that as tightly as a smooth cylindrical
      // boundary. 5% is a sanity bound, not a precision claim.
      expect(relativeDiff).toBeLessThan(0.05);
    });
  });

  describe("union of multiple primitives with a bore", () => {
    // A plus/cross cross-section: two overlapping boxes, one wide-and-short,
    // one narrow-and-tall, unioned — genuinely non-single-primitive,
    // exercising the addition-only merge pass.
    const buildSolidMembers = (): CustomMember[] => [
      makeBoxMember([0, 0, 0], [6, 3, 2]),
      makeBoxMember([0, 0, 0], [2, 3, 6]),
    ];
    const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 3, axis: 1, center: [0, 0, 0] };
    // Cross-shape area = two overlapping 6x2 rectangles, overlap is the
    // central 2x2 square counted twice in a naive sum.
    const crossArea = 6 * 2 + 6 * 2 - 2 * 2;
    const trueVolume = crossArea * 3 - Math.PI * 0.5 * 0.5 * 3;

    it("follows the addition-only merged boundary correctly, given enough budget", () => {
      // Uncapped budget, to demonstrate the algorithm itself is correct
      // (independent of the default piece/time budget). Measured: 200
      // pieces, ~57.48ms — the cross's 8 corners (4 convex, 4 reflex) push
      // well past the box case's single-primitive cost, though nowhere
      // near as bad as the gear's tooth geometry (152 pieces / 137.72ms).
      const result = decomposeBoundaryFollowingBore(buildSolidMembers(), hole, evaluator, undefined, {
        maxTotalPieces: 100000,
      });
      expect(result).not.toBeNull();
      const { pieces, volumes, raycastMs } = result!;

      expect(pieces.length).toBeGreaterThan(0);
      for (const v of volumes) expect(v).toBeGreaterThan(0);

      const total = sumVolumes(volumes);
      const relativeDiff = Math.abs(total - trueVolume) / trueVolume;

      // eslint-disable-next-line no-console
      console.log(
        `[union+bore, uncapped] pieces=${pieces.length} raycastMs=${raycastMs.toFixed(2)} total=${total.toFixed(4)} true=${trueVolume.toFixed(4)} relativeDiff=${(relativeDiff * 100).toFixed(3)}%` +
          (raycastMs > 50 ? " — EXCEEDS the 50ms budget" : " — within the 50ms budget"),
      );

      // Same reasoning as the box case: the cross shape's corners are
      // genuine kinks, not a smooth curve — a looser sanity bound than the
      // smooth-cylinder validation gate.
      expect(relativeDiff).toBeLessThan(0.05);
    });

    it("returns null at the default budget — 200 pieces needed exceeds the 128-piece cap", () => {
      // Same shape, default config. Documents that even a modest 8-corner
      // union (not just a toothed gear) can exceed the default budget once
      // 3% curvature tolerance is enforced — the cap is protecting against
      // a real, non-exotic case, not just pathological ones.
      const result = decomposeBoundaryFollowingBore(buildSolidMembers(), hole, evaluator);
      expect(result).toBeNull();
    });
  });

  describe("off-axis hole", () => {
    it("returns null", () => {
      const solidMembers: CustomMember[] = [makeCylinderMember([0, 0, 0], [4, 5, 4])];
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 5, axis: 0, center: [0, 0, 0] };
      expect(decomposeBoundaryFollowingBore(solidMembers, hole, evaluator)).toBeNull();
    });
  });

  describe("non-circular hole", () => {
    it("returns null", () => {
      const solidMembers: CustomMember[] = [makeCylinderMember([0, 0, 0], [4, 5, 4])];
      const hole: PrimitiveDescriptor = { kind: "box", halfExtents: [0.5, 2.5, 0.5], center: [0, 0, 0] };
      expect(decomposeBoundaryFollowingBore(solidMembers, hole, evaluator)).toBeNull();
    });
  });

  describe("multiple holes present in solidMembers", () => {
    it("returns null", () => {
      const solidMembers: CustomMember[] = [
        makeCylinderMember([0, 0, 0], [4, 5, 4]),
        makeCylinderMember([0, 0, 0], [1, 5, 1], true),
        makeCylinderMember([1.5, 0, 0], [0.5, 5, 0.5], true),
      ];
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 1, height: 5, axis: 1, center: [0, 0, 0] };
      expect(decomposeBoundaryFollowingBore(solidMembers, hole, evaluator)).toBeNull();
    });
  });

  describe("blind (non-through) hole", () => {
    it("returns null", () => {
      const solidMembers: CustomMember[] = [makeCylinderMember([0, 0, 0], [4, 5, 4])];
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 2, axis: 1, center: [0, 0, 0] };
      expect(decomposeBoundaryFollowingBore(solidMembers, hole, evaluator)).toBeNull();
    });
  });
});
