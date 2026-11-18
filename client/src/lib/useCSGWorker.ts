import { useEffect, useRef, useState, useCallback } from "react";
import { RequestTracker } from "./requestSupersession";
import { extractGlbArrays, type GlbGeometryArrays } from "./workerGlbRegistry";
import type { CustomMember, ShapeType } from "../pages/CadStudio";
import type { CSGResultArrays } from "./csgEvaluation";
import { LruCache } from "./lruCache";

// "members": a single shape's own CustomMember[] tree — CustomShapeMesh.tsx's
// case, evaluateCustomGeometry under the hood. "group": a CSGGroup's
// ShapeType[] members — a different algorithm (evaluateCSGGroupGeometry:
// anchor-relative transform, hole-scale boost, extra mergeVertices pass).
// Mirrors csgWorker.ts's ComputeMessage discriminant exactly.
export type CSGComputeRequest =
  | { kind: "members"; members: CustomMember[]; fallbackColor?: string }
  | {
      kind: "group";
      members: ShapeType[];
      isPhysics?: boolean;
      anchor?: [number, number, number];
      anchorRotation?: [number, number, number];
    };

type CSGWorkerResult = {
  result: CSGResultArrays | null;
  /** The key `result` was resolved for (cache hit or fresh worker reply) —
   * null while nothing has resolved yet. Lets a caller confirm its current
   * result actually corresponds to what it most recently asked for, rather
   * than just trusting RequestTracker's in-process guarantee — useful as an
   * externally-observable check (e.g. a DEV probe) that the guarantee holds
   * under real timing, not only in a unit test that constructs the race by
   * hand. */
  resolvedKey: string | null;
  loading: boolean;
  error: string | null;
  /** Worker-side fold elapsed time (ms) for the most recent resolved result.
   * Only present when a fresh worker reply arrived; undefined on cache hit. */
  evalElapsedMs: number | null;
};

// Module-level result cache, keyed by the same depsKey string the caller
// already builds — persists across a shape's component unmounting/
// remounting, same reasoning as useVoxelCollider.ts's resultCache: a
// remount (undo/redo, simulate-mode toggling) that lands back on an
// already-computed key shouldn't recompute it.
//
// Bounded: the key encodes every member transform + anchor, so a long editing
// session produces effectively unlimited distinct keys, each holding real
// typed-array buffers. An LRU keeps the revisit-an-identical-key win (undo/redo,
// simulate toggling) without the unbounded growth.
//
// The cap must comfortably exceed the number of DISTINCT CSG results LIVE AT
// ONCE, not just the undo depth — a physics/simulation scene has one entry per
// CSGGroup member, per MemberCollider fold and per VoxelizedShapeBody, and if
// the cap is below that the cache thrashes: entries evict, the compute() effect
// re-fires, and the single shared worker re-folds the same shapes forever
// without the scene ever settling. 256 covers a large assembly; superseded
// arrays are plain memory freed by GC once no mesh references them.
const resultCache = new LruCache<string, CSGResultArrays>(256);

// ── shared worker ──────────────────────────────────────────────────────────
// One worker for the whole app, multiplexed by request id — same rationale
// as useVoxelCollider.ts's shared worker (BUG-014): N simultaneously-dirty
// CSG groups must not spawn N worker threads.
type WorkerOutMessage =
  | { type: "result"; id: number; positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array; indices: Uint32Array | Uint16Array; evalElapsedMs: number }
  | { type: "error"; id: number; error: string };

let sharedWorker: Worker | null = null;
let workerInitFailed: string | null = null;
let nextRequestId = 0;
const inflight = new Map<number, (reply: WorkerOutMessage) => void>();
// URLs already registered with the worker via "register-glb" — sent once
// per distinct URL, not on every compute() call for a member tree that
// references it.
const registeredGlbUrls = new Set<string>();

function getSharedWorker(): Worker | null {
  if (sharedWorker || workerInitFailed) return sharedWorker;
  try {
    const w = new Worker(new URL("../workers/csgWorker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const reply = e.data;
      const handler = inflight.get(reply.id);
      if (!handler) return; // superseded or the requester unmounted
      inflight.delete(reply.id);
      handler(reply);
    };
    w.onerror = (e) => {
      // A worker-level failure (module parse error, OOM kill) never
      // produces a per-request reply, so every pending requester would
      // otherwise wait forever. Fail them all explicitly instead — same
      // pattern as useVoxelCollider.ts.
      const message = e.message || "CSG worker crashed";
      for (const [id, handler] of [...inflight]) {
        inflight.delete(id);
        handler({ type: "error", id, error: message });
      }
    };
    sharedWorker = w;
  } catch (err) {
    workerInitFailed = err instanceof Error ? err.message : String(err);
  }
  return sharedWorker;
}

/**
 * Ensures every URL in `glbArraysByUrl` has been registered with the shared
 * worker before a compute() request that needs it is sent. Registration
 * messages are sent in the same synchronous batch as (and before) the
 * compute() message, relying on a Worker's FIFO message ordering rather
 * than an ack round-trip — see csgWorker.ts's comment on the same point.
 */
function ensureGlbsRegistered(worker: Worker, glbArraysByUrl: Map<string, GlbGeometryArrays>) {
  glbArraysByUrl.forEach((arrays, url) => {
    if (registeredGlbUrls.has(url)) return;
    registeredGlbUrls.add(url);
    // Copies, not the caller's own arrays — extractGlbArrays() already
    // returns fresh copies (see workerGlbRegistry.ts), but compute() may be
    // called again for a member tree referencing the same URL, and a
    // transferred buffer is detached afterward. Slicing again here keeps
    // this function's contract independent of the caller's.
    const positions = arrays.positions.slice();
    const normals = arrays.normals ? arrays.normals.slice() : undefined;
    const uvs = arrays.uvs ? arrays.uvs.slice() : undefined;
    const indices = arrays.indices ? arrays.indices.slice() : undefined;
    const transferables: Transferable[] = [positions.buffer];
    if (normals) transferables.push(normals.buffer);
    if (uvs) transferables.push(uvs.buffer);
    if (indices) transferables.push(indices.buffer);
    worker.postMessage(
      { type: "register-glb", url, positions, normals, uvs, indices },
      transferables,
    );
  });
}

export function useCSGWorker(): {
  compute: (
    key: string,
    request: CSGComputeRequest,
    glbArraysByUrl: Map<string, GlbGeometryArrays>,
  ) => void;
  /** Cumulative count of requests superseded before their reply arrived —
   * telemetry only, not reactive state (nothing visual depends on it, so
   * this doesn't trigger a re-render on every drop). Read it on demand,
   * e.g. when publishing a DEV-only probe. */
  droppedCount: () => number;
} & CSGWorkerResult {
  const [result, setResult] = useState<CSGResultArrays | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evalElapsedMs, setEvalElapsedMs] = useState<number | null>(null);
  const trackerRef = useRef(new RequestTracker<string, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const tracker = trackerRef.current;
    return () => {
      mountedRef.current = false;
      tracker.reset();
    };
  }, []);

  const compute = useCallback(
    (key: string, request: CSGComputeRequest, glbArraysByUrl: Map<string, GlbGeometryArrays>) => {
      const { shouldDispatch, supersededId } = trackerRef.current.beginRequest(key);
      if (!shouldDispatch) return;

      // Drop the superseded request's handler — this is the fix BUG-050
      // lacked: a stale reply for the old key can no longer be applied,
      // because it will not be found in `inflight` when it arrives.
      if (supersededId !== null) inflight.delete(supersededId);

      const cached = resultCache.get(key);
      if (cached) {
        setResult(cached);
        setResolvedKey(key);
        setLoading(false);
        setError(null);
        setEvalElapsedMs(null);
        return;
      }

      const worker = getSharedWorker();
      if (!worker) {
        setResult(null);
        setLoading(false);
        setError(workerInitFailed ?? "CSG worker unavailable");
        trackerRef.current.resetKey();
        return;
      }

      const id = ++nextRequestId;
      trackerRef.current.setPending(key, id);
      setLoading(true);
      setError(null);

      inflight.set(id, (reply) => {
        if (!mountedRef.current || !trackerRef.current.isReplyCurrent(id)) return;
        trackerRef.current.clearPending(id);

        if (reply.type === "error") {
          setResult(null);
          setLoading(false);
          setError(reply.error);
          setEvalElapsedMs(null);
          // Allow a genuine retry rather than leaving this key permanently
          // "current" with nothing resolved for it — mirrors BUG-012's fix.
          trackerRef.current.resetKey();
          return;
        }

        const arrays: CSGResultArrays = {
          positions: reply.positions,
          normals: reply.normals,
          colors: reply.colors,
          uvs: reply.uvs,
          indices: reply.indices,
        };
        resultCache.set(key, arrays);
        setResult(arrays);
        setResolvedKey(key);
        setLoading(false);
        setError(null);
        setEvalElapsedMs(reply.evalElapsedMs ?? null);
      });

      ensureGlbsRegistered(worker, glbArraysByUrl);
      const glbUrls = [...glbArraysByUrl.keys()];
      if (request.kind === "group") {
        worker.postMessage({
          type: "compute",
          kind: "group",
          id,
          members: request.members,
          glbUrls,
          isPhysics: request.isPhysics,
          anchor: request.anchor,
          anchorRotation: request.anchorRotation,
        });
      } else {
        worker.postMessage({
          type: "compute",
          kind: "members",
          id,
          members: request.members,
          glbUrls,
          fallbackColor: request.fallbackColor,
        });
      }
    },
    [],
  );

  const droppedCount = useCallback(() => trackerRef.current.droppedCount, []);

  return { compute, result, resolvedKey, loading, error, droppedCount, evalElapsedMs };
}

// Re-exported so a call site building glbArraysByUrl for compute() doesn't
// need a second import for the one conversion function it needs.
export { extractGlbArrays };
