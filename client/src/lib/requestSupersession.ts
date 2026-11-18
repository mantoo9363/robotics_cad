/**
 * Pure state machine for "is this async reply still wanted" — the exact
 * decision BUG-050 (the deleted useCSGWorker.ts) got wrong, and BUG-009's
 * fix (useVoxelCollider.ts) got right by inlining the same logic into the
 * hook itself. Both bug-audit entries note their fix was "traced by reading
 * the sequence-guard logic, not executed" (docs/bug-audit-2026-08.md) — no
 * repro test exists for either. Extracting the decision into a plain,
 * dependency-free class makes it something a test can actually drive, so
 * this doesn't quietly re-inherit the same untested-race-fix gap a second
 * time in the CSG worker.
 *
 * One instance per logical "thing being computed" (e.g. one per shared
 * worker, keyed internally by request id — NOT one per key; `key` here is
 * "what result do I currently want", `id` is "which in-flight request, if
 * any, is trying to produce it").
 */
export class RequestTracker<TKey, TId> {
  private currentKey: TKey | null = null;
  private pendingId: TId | null = null;
  private _droppedCount = 0;

  /** Cumulative count of requests superseded before their reply arrived —
   * i.e. how many times beginRequest() has returned a non-null
   * supersededId. Exposed for telemetry (e.g. a DEV-only probe confirming
   * supersession is actually firing under real interaction, not just in
   * unit tests that construct the race by hand). */
  get droppedCount(): number {
    return this._droppedCount;
  }

  /**
   * Call at the start of compute(key). If `key` is already current, the
   * caller should no-op entirely (this mirrors useVoxelCollider.ts's
   * `if (currentKeyRef.current === key) return;`). Otherwise this commits
   * to wanting `key` and reports the id (if any) that is now superseded —
   * the caller must drop that id from its in-flight bookkeeping (e.g. a
   * shared `inflight` map) before dispatching the new request, exactly as
   * useVoxelCollider.ts's compute() does immediately after this check.
   */
  beginRequest(key: TKey): { shouldDispatch: boolean; supersededId: TId | null } {
    if (this.currentKey === key) {
      return { shouldDispatch: false, supersededId: null };
    }
    const supersededId = this.pendingId;
    if (supersededId !== null) this._droppedCount++;
    this.currentKey = key;
    this.pendingId = null;
    return { shouldDispatch: true, supersededId };
  }

  /** Call once the request for `key` has actually been dispatched and has
   * an id. A no-op if `key` was superseded between beginRequest() and this
   * call (e.g. a synchronous second compute() call before the first
   * finished setting up) — there is nothing to mark pending for. */
  setPending(key: TKey, id: TId): void {
    if (this.currentKey !== key) return;
    this.pendingId = id;
  }

  /** Call when a reply for `id` arrives. False means discard it — this is
   * the check BUG-050 never made. */
  isReplyCurrent(id: TId): boolean {
    return this.pendingId !== null && this.pendingId === id;
  }

  /** Call once a reply for `id` has been consumed (applied or resolved as a
   * failure), so a duplicate/late second message for the same id can't be
   * applied twice. */
  clearPending(id: TId): void {
    if (this.pendingId === id) this.pendingId = null;
  }

  /** Call on failure to allow a genuine retry of the same key later —
   * mirrors BUG-012's fix. Without this, a failed key stays "current"
   * forever and compute(key) no-ops on every subsequent call, even though
   * nothing was ever actually resolved for it. */
  resetKey(): void {
    this.currentKey = null;
  }

  /** Full reset — component unmount. */
  reset(): void {
    this.currentKey = null;
    this.pendingId = null;
  }
}
