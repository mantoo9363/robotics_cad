/**
 * Guards the boundary between an async CSG fold (lib/useCSGWorker.ts) and
 * packaging its result into voxelization input (lib/hollowShapeVoxelization.ts's
 * packageCustomShapeVoxelInput). Both MemberCollider.tsx and
 * VoxelizedShapeBody.tsx use this — extracted rather than duplicated, same
 * reasoning as csgKeys.ts.
 *
 * The risk this closes: useCSGWorker's `result` only updates when a NEW
 * reply resolves — it keeps showing the last resolved value across the
 * render where `depsKey` has already changed but the dispatch effect
 * hasn't fired yet (effects run after the render commits). Packaging that
 * stale `result` under the NEW depsKey's cacheKey would write the OLD
 * shape's geometry into useVoxelCollider's cache permanently under a key
 * that has never actually been folded — the same class of bug as BUG-009
 * (cache poisoning via a mismatched key), just at the CSG->voxelization
 * handoff instead of inside useVoxelCollider itself.
 *
 * A stale VISUAL mesh (Steps 3/4) is a rendering nuisance; a mismatched
 * physics collider poisoning a cache entry is a correctness bug that
 * outlives the render that caused it — worth a named, tested guard rather
 * than an inline `resolvedKey === depsKey` check duplicated in two files.
 */
export function isCSGResultCurrent(
  resolvedKey: string | null,
  depsKey: string,
  positionsLength: number | undefined,
): boolean {
  return resolvedKey === depsKey && (positionsLength ?? 0) > 0;
}
