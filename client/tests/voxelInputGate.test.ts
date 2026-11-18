import { describe, it, expect } from "vitest";
import { isCSGResultCurrent } from "@/lib/voxelInputGate";

describe("isCSGResultCurrent", () => {
  it("false when nothing has resolved yet (resolvedKey null)", () => {
    expect(isCSGResultCurrent(null, "A", 30)).toBe(false);
  });

  it("false for a stale result — the BUG-009-class scenario this guard exists for", () => {
    // depsKey changed A -> B (a customMembers edit), but the last resolved
    // key is still A because the dispatch effect for B hasn't fired yet.
    // Packaging A's positions under B's cacheKey would poison the voxel
    // cache — must be rejected.
    expect(isCSGResultCurrent("A", "B", 30)).toBe(false);
  });

  it("true once resolvedKey matches the current depsKey with real geometry", () => {
    expect(isCSGResultCurrent("A", "A", 30)).toBe(true);
  });

  it("false for a resolved-but-empty result even if the key matches (nothing to package)", () => {
    expect(isCSGResultCurrent("A", "A", 0)).toBe(false);
    expect(isCSGResultCurrent("A", "A", undefined)).toBe(false);
  });

  it("a realistic sequence: A resolves, B is dispatched (transient stale render), B resolves", () => {
    // Render 1: mounted, nothing resolved yet.
    expect(isCSGResultCurrent(null, "A", undefined)).toBe(false);
    // Render 2: A resolved.
    expect(isCSGResultCurrent("A", "A", 40)).toBe(true);
    // Render 3: customMembers edited, depsKey is now B, but useCSGWorker's
    // `result`/`resolvedKey` haven't updated yet (effect hasn't run) — this
    // is the exact transient window the guard exists for.
    expect(isCSGResultCurrent("A", "B", 40)).toBe(false);
    // Render 4: B's compute() dispatched, still pending.
    expect(isCSGResultCurrent("A", "B", 40)).toBe(false);
    // Render 5: B resolved.
    expect(isCSGResultCurrent("B", "B", 55)).toBe(true);
  });
});
