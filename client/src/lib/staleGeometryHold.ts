import * as THREE from "three";

/**
 * Holds "the geometry currently displayed" across an async recompute,
 * keeping the previous result visible while a new one is pending rather
 * than going blank — CustomShapeMesh.tsx's stale-mesh fallback (CSGGroup.tsx
 * doesn't need this: it has a real fallback, ungrouped member shapes, to
 * fall back to instead of a stale merged mesh).
 *
 * Framework-agnostic on purpose, so the swap/dispose ordering is directly
 * unit-testable without a React rendering harness (this repo doesn't have
 * one — see staleGeometryHold.test.ts). A component wraps one instance in a
 * ref and mirrors `.displayed` into state to trigger re-renders; see
 * CustomShapeMesh.tsx.
 */
export class StaleGeometryHold {
  private current: THREE.BufferGeometry | null = null;

  /**
   * Call with the latest resolved result. `incoming === null` means "still
   * pending, or resolved to nothing new" (a failure, or a genuinely empty
   * CSG result) — the currently held geometry, if any, is left exactly as
   * is and NOT disposed: that is the stale-hold behavior itself. A
   * genuinely new geometry swaps in first, then disposes whatever was
   * previously held — never the other order, so there is never a moment
   * where neither the old nor the new geometry is valid.
   *
   * Returns what should now be displayed (may be unchanged from before).
   */
  update(incoming: THREE.BufferGeometry | null): THREE.BufferGeometry | null {
    if (!incoming || incoming === this.current) return this.current;
    const previous = this.current;
    this.current = incoming;
    previous?.dispose();
    return this.current;
  }

  /** Component unmount — dispose whatever is currently held. */
  disposeAll(): void {
    this.current?.dispose();
    this.current = null;
  }

  get displayed(): THREE.BufferGeometry | null {
    return this.current;
  }
}
