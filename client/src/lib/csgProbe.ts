// DEV-only telemetry shape published by CSGGroup.tsx and CustomShapeMesh.tsx
// as window.__csgProbe, keyed by group id (first solid's id) or shape id
// respectively — stripped from production builds since every write site is
// gated behind (process.env.NODE_ENV !== "production").
export type CSGProbeEntry = {
  lastRequestAt: number | null;
  lastResolveAt: number | null;
  usingFallback: boolean;
  droppedCount: number;
  /** This render's compute key vs. the key `result` actually resolved for.
   * Equal once settled; briefly unequal is expected mid-flight. An external
   * check can poll for these converging after a burst of rapid changes, to
   * confirm the final rendered result really does correspond to the final
   * input, not a superseded one. */
  currentComputeKey: string;
  resolvedKey: string | null;
  /** Worker-side fold elapsed time (ms), from the worker's performance.now()
   * around the evaluate* call — separates worker compute from round-trip
   * transfer/reconstruct overhead. */
  evalElapsedMs?: number;
  /** CustomShapeMesh.tsx only: whether what's currently displayed is a
   * stale (superseded) result being held during a pending recompute, rather
   * than the freshest resolved one. CSGGroup.tsx has no stale-hold (it
   * falls back to ungrouped members instead), so it never sets this. */
  isStale?: boolean;
};

declare global {
  interface Window {
    __csgProbe?: Record<string, CSGProbeEntry>;
  }
}

// Ensures this file is treated as a module (required for `declare global`
// to merge rather than pollute the global scope) even though it has no
// other runtime exports.
export {};
