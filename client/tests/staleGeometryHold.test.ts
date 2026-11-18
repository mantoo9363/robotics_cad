import { describe, it, expect, vi } from "vitest";
import { StaleGeometryHold } from "@/lib/staleGeometryHold";

function fakeGeometry(name: string) {
  return { name, dispose: vi.fn() } as any;
}

describe("StaleGeometryHold", () => {
  it("starts with nothing displayed", () => {
    const hold = new StaleGeometryHold();
    expect(hold.displayed).toBeNull();
  });

  it("a pending update (null) while nothing has resolved yet stays blank", () => {
    const hold = new StaleGeometryHold();
    const result = hold.update(null);
    expect(result).toBeNull();
    expect(hold.displayed).toBeNull();
  });

  it("the first real resolve displays it, nothing to dispose yet", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    const result = hold.update(geomA);
    expect(result).toBe(geomA);
    expect(hold.displayed).toBe(geomA);
    expect(geomA.dispose).not.toHaveBeenCalled();
  });

  it("stale-hold: a pending update after a successful resolve keeps showing the stale geometry, not blank", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    hold.update(geomA);

    const result = hold.update(null); // new request now pending
    expect(result).toBe(geomA); // still showing the stale one
    expect(hold.displayed).toBe(geomA);
    expect(geomA.dispose).not.toHaveBeenCalled(); // must not be disposed while still displayed
  });

  it("resolve → new mesh visible, old geometry disposed exactly once, swap happens before dispose", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    hold.update(geomA);
    hold.update(null); // pending

    let displayedAtDisposeTime: unknown;
    geomA.dispose.mockImplementation(() => {
      // Captured inside the dispose call itself: proves the swap already
      // happened by the time disposal runs, not the other order.
      displayedAtDisposeTime = hold.displayed;
    });

    const geomB = fakeGeometry("B");
    const result = hold.update(geomB);

    expect(result).toBe(geomB);
    expect(hold.displayed).toBe(geomB);
    expect(geomA.dispose).toHaveBeenCalledTimes(1);
    expect(geomB.dispose).not.toHaveBeenCalled();
    expect(displayedAtDisposeTime).toBe(geomB); // swap-before-dispose, confirmed from inside dispose()
  });

  it("no double-dispose: repeated pending updates after a resolve don't touch the old geometry again", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    hold.update(geomA);
    const geomB = fakeGeometry("B");
    hold.update(geomB); // geomA disposed here

    hold.update(null);
    hold.update(null);
    hold.update(null);

    expect(geomA.dispose).toHaveBeenCalledTimes(1);
    expect(geomB.dispose).not.toHaveBeenCalled();
    expect(hold.displayed).toBe(geomB);
  });

  it("updating with the same object reference again is a no-op (no dispose, same display)", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    hold.update(geomA);
    const result = hold.update(geomA);
    expect(result).toBe(geomA);
    expect(geomA.dispose).not.toHaveBeenCalled();
  });

  it("disposeAll() on unmount disposes whatever is currently displayed, exactly once", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    hold.update(geomA);
    hold.disposeAll();
    expect(geomA.dispose).toHaveBeenCalledTimes(1);
    expect(hold.displayed).toBeNull();
  });

  it("disposeAll() with nothing displayed is a safe no-op", () => {
    const hold = new StaleGeometryHold();
    expect(() => hold.disposeAll()).not.toThrow();
  });

  it("a full pending -> resolve -> pending -> resolve cycle disposes each superseded geometry exactly once", () => {
    const hold = new StaleGeometryHold();
    const geomA = fakeGeometry("A");
    const geomB = fakeGeometry("B");
    const geomC = fakeGeometry("C");

    expect(hold.update(null)).toBeNull(); // first mount, pending
    expect(hold.update(geomA)).toBe(geomA); // resolves
    expect(hold.update(null)).toBe(geomA); // next request pending — stale hold
    expect(hold.update(geomB)).toBe(geomB); // resolves — A disposed
    expect(geomA.dispose).toHaveBeenCalledTimes(1);
    expect(hold.update(null)).toBe(geomB); // pending again — stale hold
    expect(hold.update(geomC)).toBe(geomC); // resolves — B disposed
    expect(geomB.dispose).toHaveBeenCalledTimes(1);

    hold.disposeAll();
    expect(geomC.dispose).toHaveBeenCalledTimes(1);
    // Only ever disposed once each, never twice.
    expect(geomA.dispose).toHaveBeenCalledTimes(1);
    expect(geomB.dispose).toHaveBeenCalledTimes(1);
  });
});
