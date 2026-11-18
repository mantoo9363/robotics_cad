import { describe, it, expect } from "vitest";
import { serializeCustomMembers, collectGlbUrlsFromCustomMembers, collectGlbUrls } from "@/components/canvas/utils/csgKeys";
import type { CustomMember, ShapeType } from "@/pages/CadStudio";

function member(
  type: CustomMember["type"],
  overrides: Partial<CustomMember> = {},
): CustomMember {
  return {
    type,
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    isHole: false,
    ...overrides,
  } as CustomMember;
}

describe("serializeCustomMembers", () => {
  it("returns an empty string for undefined", () => {
    expect(serializeCustomMembers(undefined)).toBe("");
  });

  it("returns an empty string for an empty array", () => {
    expect(serializeCustomMembers([])).toBe("");
  });

  it("changes when any serialized field changes", () => {
    const base = [member("cube", { offset: [0, 0, 0] })];
    const moved = [member("cube", { offset: [1, 0, 0] })];
    const recolored = [member("cube", { color: "#ff0000" })];
    const holed = [member("cube", { isHole: true })];

    const baseKey = serializeCustomMembers(base);
    expect(serializeCustomMembers(moved)).not.toBe(baseKey);
    expect(serializeCustomMembers(recolored)).not.toBe(baseKey);
    expect(serializeCustomMembers(holed)).not.toBe(baseKey);
  });

  it("is stable for identical content (repeatable, order-sensitive)", () => {
    const a = [member("cube"), member("sphere", { isHole: true })];
    const b = [member("cube"), member("sphere", { isHole: true })];
    expect(serializeCustomMembers(a)).toBe(serializeCustomMembers(b));

    const reordered = [member("sphere", { isHole: true }), member("cube")];
    expect(serializeCustomMembers(a)).not.toBe(serializeCustomMembers(reordered));
  });

  it("does not recurse into a member's own nested customMembers (pre-existing behavior, carried over verbatim)", () => {
    const withNested = [
      { ...member("custom"), customMembers: [member("cube", { offset: [5, 5, 5] })] },
    ];
    const withDifferentNested = [
      { ...member("custom"), customMembers: [member("cube", { offset: [9, 9, 9] })] },
    ];
    // Both serialize identically because nested customMembers aren't walked
    // — documenting the existing behavior extracted from CSGGroup.tsx, not
    // asserting it's ideal.
    expect(serializeCustomMembers(withNested)).toBe(serializeCustomMembers(withDifferentNested));
  });
});

describe("collectGlbUrlsFromCustomMembers", () => {
  it("finds a top-level glb member", () => {
    const cms = [member("glb", { url: "part.glb" })];
    expect(collectGlbUrlsFromCustomMembers(cms)).toEqual(new Set(["part.glb"]));
  });

  it("finds glb members nested inside a custom member at any depth", () => {
    const cms: CustomMember[] = [
      {
        ...member("custom"),
        customMembers: [
          member("glb", { url: "inner.glb" }),
          {
            ...member("custom"),
            customMembers: [member("glb", { url: "deep.glb" })],
          },
        ],
      },
    ];
    expect(collectGlbUrlsFromCustomMembers(cms)).toEqual(new Set(["inner.glb", "deep.glb"]));
  });

  it("returns an empty set for undefined or no glb members", () => {
    expect(collectGlbUrlsFromCustomMembers(undefined).size).toBe(0);
    expect(collectGlbUrlsFromCustomMembers([member("cube")]).size).toBe(0);
  });
});

describe("collectGlbUrls (group ShapeType[] members)", () => {
  function shape(type: ShapeType["type"], overrides: Partial<ShapeType> = {}): ShapeType {
    return {
      id: Math.random(),
      type,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#ffffff",
      isHole: false,
      ...overrides,
    } as ShapeType;
  }

  it("finds a top-level glb group member", () => {
    const members = [shape("glb", { url: "top.glb" }), shape("cube")];
    expect(collectGlbUrls(members)).toEqual(new Set(["top.glb"]));
  });

  it("finds glb members nested inside a custom group member", () => {
    const members = [
      {
        ...shape("custom"),
        customMembers: [member("glb", { url: "nested.glb" })],
      },
    ];
    expect(collectGlbUrls(members)).toEqual(new Set(["nested.glb"]));
  });
});
