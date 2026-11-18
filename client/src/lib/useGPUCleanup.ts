import { useEffect, useRef } from "react";

type CleanupFn = () => void;

// shapeId -> the set of disposers registered for it.
//
// A Set rather than a single function: the same shape can legitimately be
// mounted more than once at a time — the editor and the simulation, or a
// gripper's nested KinematicNode rendering a grabbed shape alongside the
// original. Keying one disposer per id meant the second mount silently
// overwrote the first, so that first wrapper's materials were never released.
// See BUG-039.
const disposers = new Map<number, Set<CleanupFn>>();

/**
 * Registers a disposer for a shape. Returns an unregister function — call it
 * when the owning component unmounts so the entry does not outlive it.
 *
 * Registering the same function twice is a no-op (Set semantics), so a
 * component that re-registers on a dependency change cannot accumulate stale
 * entries for the same closure.
 */
export function registerDisposer(shapeId: number, fn: CleanupFn): () => void {
  let set = disposers.get(shapeId);
  if (!set) {
    set = new Set();
    disposers.set(shapeId, set);
  }
  set.add(fn);
  return () => {
    const s = disposers.get(shapeId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) disposers.delete(shapeId);
  };
}

/**
 * Disposes GPU resources for shapes that have disappeared from the scene.
 * Every disposer registered for a removed id runs, not just the most recent.
 */
export function useGPUCleanup(shapeIds: Set<number>): void {
  const prevIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const prevIds = prevIdsRef.current;
    const currentIds = shapeIds;

    const removedIds: number[] = [];
    prevIds.forEach((id) => {
      if (!currentIds.has(id)) removedIds.push(id);
    });

    removedIds.forEach((id) => {
      const set = disposers.get(id);
      if (!set) return;
      // Copy before iterating: a disposer may unregister itself.
      [...set].forEach((dispose) => dispose());
      disposers.delete(id);
    });

    prevIdsRef.current = new Set(currentIds);
  }, [shapeIds]);
}

export function cleanup(): void {
  disposers.forEach((set) => [...set].forEach((fn) => fn()));
  disposers.clear();
}
