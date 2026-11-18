import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  decomposeConcentricBore,
  fitCylinderFromMesh,
  isRoughlyCylindrical,
  DEFAULT_WEDGE_COUNT,
  buildNativeCylinderFitDescriptor,
  tryBuildUpsampledCylinderDescriptor,
  NATIVE_CYLINDER_FIT_SEGMENTS,
  CYLINDER_VOLUME_FILL_TOLERANCE,
  type PrimitiveDescriptor,
} from "@/lib/concentricBoreDecomposition";
import { meshVolume } from "@/lib/hollowShapeVoxelization";
import type { CustomMember } from "@/pages/CadStudio";

type RawMesh = { positions: Float32Array; indices?: Uint32Array };

function loadGlbGeometry(relPath: string): Promise<RawMesh> {
  const loader = new GLTFLoader();
  const buf = fs.readFileSync(path.resolve(process.cwd(), relPath));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(
      ab,
      "",
      (gltf) => {
        let geom: any;
        gltf.scene.traverse((n: any) => {
          if (n.isMesh) geom = n.geometry;
        });
        const positions = new Float32Array(geom.attributes.position.array);
        const indices = geom.index ? new Uint32Array(geom.index.array) : undefined;
        resolve({ positions, indices });
      },
      reject,
    );
  });
}

// Mirrors the scale a caller applies to a CustomMember's local geometry
// before it reaches this module — decomposeConcentricBore itself takes
// already-scaled input (see the module's own "local, unscaled [by this
// function]" framing: scale is the caller's job).
function scalePositions(positions: Float32Array, scale: [number, number, number]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] * scale[0];
    out[i + 1] = positions[i + 1] * scale[1];
    out[i + 2] = positions[i + 2] * scale[2];
  }
  return out;
}

function sumVolumes(volumes: number[]): number {
  return volumes.reduce((a, b) => a + b, 0);
}

describe("concentricBoreDecomposition", () => {
  let cylinderRaw: RawMesh;

  beforeAll(async () => {
    cylinderRaw = await loadGlbGeometry("public/uploads/cylinder.glb");
  });

  describe("collar/shaft geometry (this session's fixture: cylinder.glb outer minus cylinder.glb inner)", () => {
    it("decomposes into wedges whose volumes sum to the exact annulus volume, with no degenerate piece", () => {
      // Same scale factors as the session's actual collar shape.
      const outerScale: [number, number, number] = [1.5, 10, 1.5];
      const innerScale: [number, number, number] = [1, 10, 1];
      const solidPositions = scalePositions(cylinderRaw.positions, outerScale);
      const holePositions = scalePositions(cylinderRaw.positions, innerScale);

      const solid: PrimitiveDescriptor = {
        kind: "mesh",
        positions: solidPositions,
        indices: cylinderRaw.indices,
      };
      const hole: PrimitiveDescriptor = {
        kind: "mesh",
        positions: holePositions,
        indices: cylinderRaw.indices,
      };

      const result = decomposeConcentricBore(solid, hole);
      expect(result).not.toBeNull();
      const { pieces, volumes } = result!;

      expect(pieces.length).toBe(DEFAULT_WEDGE_COUNT);
      expect(volumes.length).toBe(DEFAULT_WEDGE_COUNT);

      // Expected volume from the *fitted* (recognized) cylinder params, not
      // the raw mesh's own volume — the wedge builder works from the fit,
      // and a real mesh's volume deviates slightly (~0.6%) from an ideal
      // cylinder's by construction (see the module's tolerance comment).
      const solidFit = fitCylinderFromMesh(solidPositions, cylinderRaw.indices)!;
      const holeFit = fitCylinderFromMesh(holePositions, cylinderRaw.indices)!;
      expect(solidFit).not.toBeNull();
      expect(holeFit).not.toBeNull();

      const expectedVolume =
        Math.PI * solidFit.params.radius ** 2 * solidFit.params.height -
        Math.PI * holeFit.params.radius ** 2 * solidFit.params.height;

      // The annular-sector formula summed over a complete 2π sweep
      // reconstructs the full annulus exactly (no discretization error,
      // unlike voxelization) — tight tolerance is intentional here.
      expect(sumVolumes(volumes)).toBeCloseTo(expectedVolume, 6);

      for (const v of volumes) {
        expect(v).toBeGreaterThan(0);
      }
    });
  });

  describe("native-primitive cylinder with bore (non-GLB)", () => {
    it("decomposes correctly from exact analytic inputs", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 2, height: 5, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.8, height: 5, axis: 1, center: [0, 0, 0] };

      const result = decomposeConcentricBore(solid, hole, 16);
      expect(result).not.toBeNull();
      const { pieces, volumes } = result!;

      expect(pieces.length).toBe(16);
      expect(volumes.length).toBe(16);

      const expectedVolume = Math.PI * (2 ** 2 - 0.8 ** 2) * 5;
      // Exact analytic inputs → this should be exact to floating-point
      // precision, not just "close".
      expect(sumVolumes(volumes)).toBeCloseTo(expectedVolume, 9);

      for (const v of volumes) {
        expect(v).toBeGreaterThan(0);
      }
      // Each wedge is a quad-prism: 4 corners × 2 layers (top/bottom).
      for (const p of pieces) {
        expect(p.positions.length).toBe(24);
      }
    });

    it("defaults to DEFAULT_WEDGE_COUNT when wedgeCount isn't specified", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 1, height: 1, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.3, height: 1, axis: 1, center: [0, 0, 0] };
      const result = decomposeConcentricBore(solid, hole);
      expect(result?.pieces.length).toBe(DEFAULT_WEDGE_COUNT);
    });
  });

  describe("off-axis / non-concentric holes", () => {
    it("returns null when the hole's axis doesn't match the solid's", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 2, height: 5, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 5, axis: 0, center: [0, 0, 0] };
      expect(decomposeConcentricBore(solid, hole)).toBeNull();
    });

    it("returns null when the hole is radially offset beyond tolerance (same axis, off-center)", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 2, height: 5, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 5, axis: 1, center: [1, 0, 0] };
      expect(decomposeConcentricBore(solid, hole)).toBeNull();
    });
  });

  describe("box solid with a circular bore", () => {
    it("returns null — explicitly out of scope for v1", () => {
      const solid: PrimitiveDescriptor = { kind: "box", halfExtents: [2, 2.5, 2], center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 5, axis: 1, center: [0, 0, 0] };
      expect(decomposeConcentricBore(solid, hole)).toBeNull();
    });
  });

  describe("other invalid inputs", () => {
    it("returns null when the hole radius is not smaller than the solid's", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 1, height: 5, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 1, height: 5, axis: 1, center: [0, 0, 0] };
      expect(decomposeConcentricBore(solid, hole)).toBeNull();
    });

    it("returns null for a blind (partial-depth) hole", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 2, height: 5, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 2, axis: 1, center: [0, 0, 0] };
      expect(decomposeConcentricBore(solid, hole)).toBeNull();
    });

    it("returns null when wedgeCount is below the convexity floor", () => {
      const solid: PrimitiveDescriptor = { kind: "cylinder", radius: 2, height: 5, axis: 1, center: [0, 0, 0] };
      const hole: PrimitiveDescriptor = { kind: "cylinder", radius: 0.5, height: 5, axis: 1, center: [0, 0, 0] };
      expect(decomposeConcentricBore(solid, hole, 2)).toBeNull();
    });
  });

  describe("fitCylinderFromMesh / isRoughlyCylindrical (GLB recognition)", () => {
    it("recognizes real cylinder.glb", () => {
      const fit = fitCylinderFromMesh(cylinderRaw.positions, cylinderRaw.indices);
      expect(fit).not.toBeNull();
      expect(fit!.volumeFillDeviation).toBeLessThan(0.02);
      expect(isRoughlyCylindrical(cylinderRaw.positions, cylinderRaw.indices)).toBe(true);
    });

    it("rejects a degenerate (zero-volume) mesh", () => {
      // Two coplanar triangles — zero volume, should never be recognized
      // regardless of tolerance.
      const positions = new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
      ]);
      expect(fitCylinderFromMesh(positions)).toBeNull();
    });
  });

  describe("native cylinder fit-upsampling (fixes the pipe near-miss found by the coverage survey)", () => {
    // The exact "pipe" preset from CadStudio.tsx: 1 solid 16-segment
    // native cylinder + 1 concentric 16-segment native cylindrical hole.
    // Before this fix, resolving both via the app's shared 16-segment
    // render cache measured 2.55% volumeFillDeviation — a near-miss
    // against the 2% tolerance that rejected this shape outright, despite
    // it being a textbook case for Tier 1a.
    const PIPE_SOLID_SCALE: [number, number, number] = [1, 1, 1];
    const PIPE_HOLE_SCALE: [number, number, number] = [0.75, 1.1, 0.75];

    it("recognizes and decomposes the pipe case via the upsampled descriptor, matching the closed-form annulus volume", () => {
      const solid = buildNativeCylinderFitDescriptor(PIPE_SOLID_SCALE, [0, 0, 0], [0, 0, 0]);
      const hole = buildNativeCylinderFitDescriptor(PIPE_HOLE_SCALE, [0, 0, 0], [0, 0, 0]);

      const result = decomposeConcentricBore(solid, hole);
      expect(result).not.toBeNull();
      const { pieces, volumes } = result!;
      expect(pieces.length).toBe(DEFAULT_WEDGE_COUNT);

      // Expected volume from the base unit cylinder's exact analytic
      // radius/height (0.5, 1) scaled directly — not a fit, since we know
      // the true parametric shape here (this is the reference the fitted
      // wedge decomposition should agree with).
      const solidRadius = 0.5 * PIPE_SOLID_SCALE[0];
      const solidHeight = 1 * PIPE_SOLID_SCALE[1];
      const holeRadius = 0.5 * PIPE_HOLE_SCALE[0];
      const expectedVolume = Math.PI * (solidRadius ** 2 - holeRadius ** 2) * solidHeight;

      const total = volumes.reduce((a, b) => a + b, 0);
      const relativeDiff = Math.abs(total - expectedVolume) / expectedVolume;
      // eslint-disable-next-line no-console
      console.log(`[pipe, upsampled] total=${total.toFixed(6)} expected=${expectedVolume.toFixed(6)} relativeDiff=${(relativeDiff * 100).toFixed(3)}%`);

      // Tighter than the near-miss's old 2.55% deviation by a wide margin
      // — this is a real closed-form comparison, not a loose sanity bound.
      expect(relativeDiff).toBeLessThan(0.01);
      for (const v of volumes) expect(v).toBeGreaterThan(0);
    });

    it("also recognizes the hole in isolation via tryBuildUpsampledCylinderDescriptor from a CustomMember", () => {
      const holeMember: CustomMember = {
        type: "cylinder",
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: PIPE_HOLE_SCALE,
        isHole: true,
      };
      const desc = tryBuildUpsampledCylinderDescriptor(holeMember);
      expect(desc).not.toBeNull();
      expect(fitCylinderFromMesh((desc as any).positions, (desc as any).indices)).not.toBeNull();
    });

    it("returns null for non-cylinder member types, unaffected by this fix (requirement 1)", () => {
      const cubeMember: CustomMember = { type: "cube", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false };
      const glbMember: CustomMember = { type: "glb", url: "some.glb", offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], isHole: false };
      expect(tryBuildUpsampledCylinderDescriptor(cubeMember)).toBeNull();
      expect(tryBuildUpsampledCylinderDescriptor(glbMember)).toBeNull();
    });

    it("SANITY CHECK (requirement 2): volumeFillDeviation strictly decreases as segment count rises — upsampling can only turn a near-miss into a pass, never the reverse", () => {
      const measured: Array<{ segments: number; deviation: number }> = [];
      for (const segments of [8, 16, 24, NATIVE_CYLINDER_FIT_SEGMENTS]) {
        const geom = new THREE.CylinderGeometry(0.5, 0.5, 1, segments);
        const positions = new Float32Array(geom.attributes.position.array);
        const indices = geom.index ? new Uint32Array(geom.index.array) : undefined;
        const actualVolume = meshVolume(positions, indices);
        const idealVolume = Math.PI * 0.5 * 0.5 * 1;
        const deviation = Math.abs(actualVolume - idealVolume) / idealVolume;
        measured.push({ segments, deviation });
      }

      // eslint-disable-next-line no-console
      console.log(
        "[monotonicity] " + measured.map((m) => `${m.segments}seg=${(m.deviation * 100).toFixed(3)}%`).join(" "),
      );

      for (let i = 1; i < measured.length; i++) {
        expect(measured[i].deviation).toBeLessThan(measured[i - 1].deviation);
      }
      // The app's shared render default (16 segments) is a near-miss...
      expect(measured[1].deviation).toBeGreaterThan(CYLINDER_VOLUME_FILL_TOLERANCE);
      // ...while the fit-upsampled resolution comfortably clears it.
      expect(measured[3].deviation).toBeLessThan(CYLINDER_VOLUME_FILL_TOLERANCE);
    });

    it("PERFORMANCE (requirement 3): measures real overhead of building the upsampled descriptor", () => {
      const iterations = 200;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        buildNativeCylinderFitDescriptor(PIPE_HOLE_SCALE, [0, 0, 0], [0, 0, 0]);
      }
      const elapsed = performance.now() - start;
      const perCall = elapsed / iterations;
      // eslint-disable-next-line no-console
      console.log(`[perf] ${iterations} calls in ${elapsed.toFixed(2)}ms — ${perCall.toFixed(4)}ms/call`);

      // A single shape's fit-check needs at most 2 calls (solid + hole),
      // once per shape at collider-build time (memoized by the caller,
      // same caching contract as the rest of this decomposer family) — not
      // a per-frame cost. Generous bound, not a tight perf claim.
      expect(perCall).toBeLessThan(5);
    });
  });
});
