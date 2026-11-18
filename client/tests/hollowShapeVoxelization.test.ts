import { describe, it, expect } from "vitest";
import { Evaluator } from "three-bvh-csg";
import {
  buildCustomShapeVoxelInput,
  packageCustomShapeVoxelInput,
} from "@/lib/hollowShapeVoxelization";
import { evaluateCustomGeometryFromArrays } from "@/lib/csgEvaluation";
import type { CustomMember, ShapeType } from "@/pages/CadStudio";

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

function shape(customMembers: CustomMember[], scale: [number, number, number] = [1, 1, 1]): ShapeType {
  return {
    id: 1,
    type: "custom",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale,
    color: "#ffffff",
    isHole: false,
    customMembers,
  } as ShapeType;
}

// Real "arch" preset (see CadStudio.tsx addShape()), reused across Steps
// 1-4's fixtures — 3 members, 2 holes.
const archMembers: CustomMember[] = [
  member("cube", [0, 0, 0], [1, 1.2, 0.4]),
  member("cylinder", [0, -0.2, 0], [0.6, 1, 0.6], true, [Math.PI / 2, 0, 0]),
  member("cube", [0, -0.5, 0], [0.6, 0.6, 1], true),
];

function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>) {
  expect(Array.from(a)).toEqual(Array.from(b));
}

describe("packageCustomShapeVoxelInput matches buildCustomShapeVoxelInput end to end", () => {
  it("via the new fold-then-package path (evaluateCustomGeometryFromArrays + packageCustomShapeVoxelInput)", () => {
    const s = shape(archMembers, [2, 1.5, 3]);
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];

    const direct = buildCustomShapeVoxelInput(s, evaluator, undefined);
    expect(direct).not.toBeNull();

    const folded = evaluateCustomGeometryFromArrays(archMembers, new Map(), s.color);
    const viaSplit = packageCustomShapeVoxelInput(s, folded.positions, folded.indices);
    expect(viaSplit).not.toBeNull();

    arraysEqual(direct!.positions, viaSplit!.positions);
    if (direct!.indices || viaSplit!.indices) {
      arraysEqual(direct!.indices ?? [], viaSplit!.indices ?? []);
    }
    expect(viaSplit!.cacheKey).toBe(direct!.cacheKey);
    expect(viaSplit!.featureRegions).toEqual(direct!.featureRegions);
  });

  it("scale is applied correctly (positions differ proportionally from the unscaled fold)", () => {
    const unscaled = evaluateCustomGeometryFromArrays(archMembers, new Map(), "#ffffff");
    const s2x = shape(archMembers, [2, 2, 2]);
    const packaged = packageCustomShapeVoxelInput(s2x, unscaled.positions, unscaled.indices);
    expect(packaged).not.toBeNull();
    for (let i = 0; i < unscaled.positions.length; i++) {
      expect(packaged!.positions[i]).toBeCloseTo(unscaled.positions[i] * 2, 5);
    }
  });

  it("empty folded positions (0 length) returns null, matching the original empty-bbox behavior", () => {
    const s = shape(archMembers);
    const result = packageCustomShapeVoxelInput(s, new Float32Array(0), undefined);
    expect(result).toBeNull();
  });

  it("no customMembers at all returns null (buildCustomShapeVoxelInput's own guard)", () => {
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal", "color", "uv"];
    const s = shape([]);
    expect(buildCustomShapeVoxelInput(s, evaluator, undefined)).toBeNull();
  });

  it("indices convert to Uint32Array regardless of the folded array's own width", () => {
    const s = shape(archMembers);
    const u16 = new Uint16Array([0, 1, 2]);
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const result = packageCustomShapeVoxelInput(s, positions, u16);
    expect(result).not.toBeNull();
    expect(result!.indices).toBeInstanceOf(Uint32Array);
    arraysEqual(result!.indices!, u16);
  });
});
