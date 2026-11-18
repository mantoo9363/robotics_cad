/**
 * Minimal insertion-order LRU built on a `Map`.
 *
 * Used to bound the module-level result caches in `useCSGWorker.ts` and
 * `useVoxelCollider.ts`. Those persist across component unmount/remount on
 * purpose (undo/redo, simulate-mode toggling), but their keys encode every
 * member transform / anchor, so during an editing session they grow without
 * limit — each entry holding real `Float32Array`/`Uint32Array` buffers or a
 * `VoxelBox[]`. A bounded LRU keeps the "revisit an identical key" win while
 * capping retained memory.
 *
 * `get` promotes the key to most-recently-used; `set` evicts the
 * least-recently-used entries once `max` is exceeded. `onEvict` runs for each
 * dropped value — nothing on the main thread holds GPU handles today (the
 * worker-side brush cache in `csgWorker.ts` is the one that disposes), but the
 * hook is here for callers that need it.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly max: number;
  private readonly onEvict?: (value: V, key: K) => void;

  constructor(max: number, onEvict?: (value: V, key: K) => void) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`LruCache: max must be a positive integer, got ${max}`);
    }
    this.max = max;
    this.onEvict = onEvict;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    // Re-insert so this key becomes the newest in Map iteration order.
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value as K;
      const oldestValue = this.map.get(oldestKey)!;
      this.map.delete(oldestKey);
      this.onEvict?.(oldestValue, oldestKey);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    if (this.onEvict) {
      for (const [k, v] of this.map) this.onEvict(v, k);
    }
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
