import { useEffect, useRef, useState, useCallback } from "react";
import type { VoxelBox, FeatureRegion } from "./voxelCollider";
import { LruCache } from "./lruCache";

type VoxelColliderResult = {
  boxes: VoxelBox[] | null;
  loading: boolean;
  error: string | null;
};

// Module-level, not component state — persists across a shape's component
// unmounting/remounting (e.g. stopping and restarting the simulation),
// which is exactly when a fresh RigidBody remounts and would otherwise
// recompute an identical shape's voxelization from scratch every time.
//
// Bounded LRU (same reasoning as useCSGWorker.ts's resultCache): the key
// encodes the shape's geometry + transform, so editing produces unlimited
// distinct keys, each holding a potentially large VoxelBox[]. The cap must
// exceed the number of voxelized bodies live at once in a physics scene, or
// the cache thrashes and colliders never settle. 256 covers a large assembly.
const resultCache = new LruCache<string, VoxelBox[]>(256);

// ── shared worker ──────────────────────────────────────────────────────────
// One worker for the whole app, multiplexed by request id, rather than one per
// component instance. Every VoxelCompoundColliders and VoxelizedShapeBody used
// to spawn its own, so an assembly with N hollow members held N worker threads
// — each with its own module graph and its own BVH copies — and MemberCollider's
// recursive expansion multiplied that further. See BUG-014.
type WorkerReply = { id: number; boxes: VoxelBox[]; error?: string };

let sharedWorker: Worker | null = null;
let workerInitFailed: string | null = null;
let nextRequestId = 0;
const inflight = new Map<number, (reply: WorkerReply) => void>();

function getSharedWorker(): Worker | null {
  if (sharedWorker || workerInitFailed) return sharedWorker;
  try {
    const w = new Worker(new URL("../workers/voxelColliderWorker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const reply = e.data;
      const handler = inflight.get(reply.id);
      if (!handler) return; // superseded or the requester unmounted
      inflight.delete(reply.id);
      handler(reply);
    };
    w.onerror = (e) => {
      // A worker-level failure (module parse error, OOM kill) never produces a
      // per-request reply, so every pending requester would otherwise wait
      // forever. Fail them all explicitly instead.
      const message = e.message || "voxel worker crashed";
      for (const [id, handler] of [...inflight]) {
        inflight.delete(id);
        handler({ id, boxes: [], error: message });
      }
    };
    sharedWorker = w;
  } catch (err) {
    workerInitFailed = err instanceof Error ? err.message : String(err);
  }
  return sharedWorker;
}

export function useVoxelCollider(): {
  compute: (
    key: string,
    positions: Float32Array,
    indices: Uint32Array | undefined,
    featureRegions: FeatureRegion[],
  ) => void;
} & VoxelColliderResult {
  const [boxes, setBoxes] = useState<VoxelBox[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The key this hook currently represents, and the id of the request in
  // flight for it (if any). Both are needed: the key decides whether a new
  // compute() is a no-op, the id decides whether an arriving reply is still
  // wanted.
  const currentKeyRef = useRef<string | null>(null);
  const pendingIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Drop our in-flight request so the shared worker's reply is discarded
      // rather than setting state on an unmounted component. The worker keeps
      // running — it is shared, and another instance may want the same key.
      if (pendingIdRef.current !== null) inflight.delete(pendingIdRef.current);
      pendingIdRef.current = null;
      // A remount must be able to ask for the same key again.
      currentKeyRef.current = null;
    };
  }, []);

  const compute = useCallback(
    (
      key: string,
      positions: Float32Array,
      indices: Uint32Array | undefined,
      featureRegions: FeatureRegion[],
    ) => {
      if (currentKeyRef.current === key) return;
      currentKeyRef.current = key;

      // Any request still in flight is for a different key now. Drop it before
      // doing anything else.
      //
      // This is what fixed the cache-poisoning bug: the old code took its
      // "is this reply still current" decision from a sequence number that the
      // cache-hit path below never incremented, and then wrote the reply under
      // whatever key was latest rather than the key the request was made for.
      // A shape edited A -> B, where B was already cached while A was still
      // computing, ended up with A's colliders stored under B's key —
      // permanently, for the rest of the session. Carrying the key inside the
      // request closure makes that unrepresentable. See BUG-009.
      if (pendingIdRef.current !== null) {
        inflight.delete(pendingIdRef.current);
        pendingIdRef.current = null;
      }

      const cached = resultCache.get(key);
      if (cached) {
        setBoxes(cached);
        setLoading(false);
        setError(null);
        return;
      }

      const worker = getSharedWorker();
      if (!worker) {
        // No worker at all. Resolve as a failure rather than sitting in
        // `loading` forever — the caller's fallback collider is much better
        // than a body that never becomes dynamic. See BUG-010/BUG-013.
        setBoxes([]);
        setLoading(false);
        setError(workerInitFailed ?? "voxel worker unavailable");
        return;
      }

      const id = ++nextRequestId;
      pendingIdRef.current = id;
      setLoading(true);
      setError(null);

      inflight.set(id, (reply) => {
        if (!mountedRef.current || pendingIdRef.current !== id) return;
        pendingIdRef.current = null;

        if (reply.error) {
          // Resolve as an empty result, not as "still nothing". The consumer
          // treats `boxes === null` as "not resolved yet" and keeps the body
          // kinematic forever on that reading; an empty array is what makes it
          // take the documented fallback path and go dynamic. See BUG-010.
          setBoxes([]);
          setLoading(false);
          setError(reply.error);
          // Allow a genuine retry: the key stays wrong-but-recorded otherwise,
          // and compute() would no-op for this shape for the rest of the
          // session. See BUG-012.
          if (currentKeyRef.current === key) currentKeyRef.current = null;
          return;
        }

        // Cached under the key this request was MADE for, never under whatever
        // key happens to be current when it lands.
        resultCache.set(key, reply.boxes);
        setBoxes(reply.boxes);
        setLoading(false);
        setError(null);
      });

      // Transfer copies, not the caller's own arrays — transferring detaches
      // the buffer, and the caller's memoized voxelInput can outlive this
      // single compute() call (re-renders, or a StrictMode-simulated
      // remount that fires this effect again with the same memoized
      // arrays). Transferring the original would leave it detached for any
      // later call, which throws a DataCloneError trying to transfer it again.
      const positionsCopy = positions.slice();
      const indicesCopy = indices ? indices.slice() : undefined;
      const transferables: Transferable[] = [positionsCopy.buffer];
      if (indicesCopy) transferables.push(indicesCopy.buffer);
      worker.postMessage(
        { id, positions: positionsCopy, indices: indicesCopy, featureRegions },
        transferables,
      );
    },
    [],
  );

  return { compute, boxes, loading, error };
}
