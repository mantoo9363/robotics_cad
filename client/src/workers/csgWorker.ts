import {
  evaluateCustomGeometryFromArrays,
  evaluateCSGGroupGeometryFromArrays,
  evaluateCustomGeometryFromArraysWithBrush,
  evaluateCSGGroupGeometryFromArraysWithBrush,
  evaluateIncrementalCSG,
} from "../lib/csgEvaluation";
import type { GlbGeometryArrays } from "../lib/workerGlbRegistry";
import type { CustomMember, ShapeType } from "../pages/CadStudio";
import { Evaluator } from "three-bvh-csg";

// Worker-local cache of registered GLB arrays, keyed by URL. Populated by
// "register-glb" messages, which the caller (useCSGWorker.ts) sends before
// any "compute" message that references that URL — a single Worker's
// message queue is strictly FIFO, so by the time a "compute" message is
// handled here, every "register-glb" message sent before it has already
// been processed. No ack round-trip is needed for that ordering guarantee.
const glbCache = new Map<string, GlbGeometryArrays>();

type RegisterGlbMessage = {
  type: "register-glb";
  url: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint32Array | Uint16Array;
};

// "members": a single shape's own CustomMember[] tree (evaluateCustomGeometry
// — CustomShapeMesh.tsx's case). "group": a CSGGroup's ShapeType[] members,
// a different algorithm (evaluateCSGGroupGeometry — anchor-relative
// transform, hole-scale boost, extra mergeVertices pass). See
// geometryHelpers.ts's doc comment on evaluateCSGGroupGeometry for why these
// aren't the same function.
type ComputeMessage =
  | {
      type: "compute";
      kind: "members";
      id: number;
      members: CustomMember[];
      glbUrls: string[];
      fallbackColor?: string;
    }
  | {
      type: "compute";
      kind: "group";
      id: number;
      members: ShapeType[];
      glbUrls: string[];
      isPhysics?: boolean;
      anchor?: [number, number, number];
      anchorRotation?: [number, number, number];
    };

type InMessage = RegisterGlbMessage | ComputeMessage;

type ResultMessage = {
  type: "result";
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array | Uint16Array;
  evalElapsedMs: number;
};

type ErrorMessage = {
  type: "error";
  id: number;
  error: string;
};

/**
 * Generates a cache key for a member set. For "members" kind, uses the
 * serialized customMembers. For "group" kind, uses the serialized ShapeType[]
 * array. The key must uniquely identify the member set (order-sensitive).
 */
function getMemberKey(kind: "members" | "group", members: CustomMember[] | ShapeType[]): string {
  if (kind === "members") {
    return (members as CustomMember[])
      .map(
        (m) =>
          `${m.type}-${m.url || ""}-${m.offset.join(",")}-${m.rotation.join(",")}-${m.scale.join(
            ",",
          )}-${m.isHole}-${m.color || ""}`,
      )
      .join(";");
  } else {
    return (members as ShapeType[])
      .map(
        (s) =>
          `${s.id}-${s.type}-${s.url || ""}-${s.position.join(",")}-${s.rotation.join(
            ",",
          )}-${s.scale.join(",")}-${s.color || ""}-${s.isHole}`,
      )
      .join("|");
  }
}

// Per-kind prefix brush cache. Key = serialized member prefix, Value = preCreaseBrush.
// Separate caches for "members" and "group" because the fold algorithms differ.
interface CachedEntry {
  preCreaseBrush: any; // Brush - using any to avoid circular imports
  key: string;
}

const membersPrefixCache = new Map<string, CachedEntry>();
const groupPrefixCache = new Map<string, CachedEntry>();

const MAX_PREFIX_CACHE_SIZE = 16;

function getCache(kind: "members" | "group"): Map<string, CachedEntry> {
  return kind === "members" ? membersPrefixCache : groupPrefixCache;
}

function pruneCache(kind: "members" | "group"): void {
  const cache = getCache(kind);
  if (cache.size > MAX_PREFIX_CACHE_SIZE) {
    const entriesToRemove = cache.size - MAX_PREFIX_CACHE_SIZE;
    let count = 0;
    for (const key of cache.keys()) {
      const entry = cache.get(key);
      if (entry?.preCreaseBrush?.geometry) {
        entry.preCreaseBrush.geometry.dispose();
      }
      cache.delete(key);
      count++;
      if (count >= entriesToRemove) break;
    }
  }
}

function clearCache(kind: "members" | "group"): void {
  const cache = getCache(kind);
  for (const [, entry] of cache) {
    if (entry.preCreaseBrush?.geometry) {
      entry.preCreaseBrush.geometry.dispose();
    }
  }
  cache.clear();
}

// Create a single shared evaluator instance for incremental operations
const sharedEvaluator = new Evaluator();
sharedEvaluator.attributes = ["position", "normal", "color", "uv"];

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;

  if (msg.type === "register-glb") {
    glbCache.set(msg.url, {
      positions: msg.positions,
      normals: msg.normals,
      uvs: msg.uvs,
      indices: msg.indices,
    });
    return;
  }

  const { id, glbUrls } = msg;
  try {
    const missing = glbUrls.filter((url) => !glbCache.has(url));
    if (missing.length > 0) {
      throw new Error(
        `[csgWorker] compute request referenced unregistered GLB URL(s): ${missing.join(", ")}`,
      );
    }

    const glbArraysByUrl = new Map<string, GlbGeometryArrays>();
    glbUrls.forEach((url) => glbArraysByUrl.set(url, glbCache.get(url)!));

    const evalStart = performance.now();

    let resultArrays: ReturnType<typeof evaluateCustomGeometryFromArrays>;
    const kind = msg.kind;

    if (kind === "members") {
      const memberKey = getMemberKey("members", msg.members);
      const cachedEntry = membersPrefixCache.get(memberKey);

      if (cachedEntry) {
        // Exact cache hit - recompute for now (could optimize to reuse if needed)
        resultArrays = evaluateCustomGeometryFromArrays(
          msg.members,
          glbArraysByUrl,
          msg.fallbackColor,
        );
      } else {
        // Try to find the longest cached prefix that is a monotonic add
        let bestPrefixEntry: CachedEntry | null = null;
        let bestPrefixKey = "";
        let newMember: CustomMember | null = null;
        let isHole = false;

        // Check all possible prefixes (full - 1, full - 2, ...) for a cached match
        for (let len = msg.members.length - 1; len >= 1; len--) {
          const prefix = msg.members.slice(0, len);
          const prefixKey = getMemberKey("members", prefix);
          const prefixEntry = membersPrefixCache.get(prefixKey);
          if (prefixEntry) {
            // Check if msg.members is prefix + one additional member at the end
            if (msg.members.length === len + 1) {
              const candidate = msg.members[len];
              // Verify the prefix matches exactly
              let matches = true;
              for (let i = 0; i < len; i++) {
                const oldM = prefix[i] as CustomMember;
                const newM = msg.members[i] as CustomMember;
                if (
                  oldM.type !== newM.type ||
                  oldM.url !== newM.url ||
                  oldM.offset.join(",") !== newM.offset.join(",") ||
                  oldM.rotation.join(",") !== newM.rotation.join(",") ||
                  oldM.scale.join(",") !== newM.scale.join(",") ||
                  oldM.isHole !== newM.isHole ||
                  oldM.color !== newM.color
                ) {
                  matches = false;
                  break;
                }
              }
              if (matches) {
                bestPrefixEntry = prefixEntry;
                bestPrefixKey = prefixKey;
                newMember = candidate;
                isHole = candidate.isHole ?? false;
                break; // Use the longest prefix
              }
            }
          }
        }

        if (bestPrefixEntry && bestPrefixEntry.preCreaseBrush && newMember) {
          // Apply incremental operation using the cached prefix brush
          resultArrays = evaluateIncrementalCSG(
            sharedEvaluator,
            bestPrefixEntry.preCreaseBrush,
            newMember,
            glbArraysByUrl,
            false, // isGroupPath
            isHole,
            msg.fallbackColor,
          );
          // Cache the new full result
          const fullResult = evaluateCustomGeometryFromArraysWithBrush(
            msg.members,
            glbArraysByUrl,
            msg.fallbackColor,
          );
          // Don't cache a prefix with no brush (degenerate member set) — the
          // incremental path would later fold onto a null base and crash.
          if (fullResult.preCreaseBrush) {
            membersPrefixCache.set(memberKey, { preCreaseBrush: fullResult.preCreaseBrush, key: memberKey });
            pruneCache("members");
          }
        } else {
          // Full recompute with brush caching
          const fullResult = evaluateCustomGeometryFromArraysWithBrush(
            msg.members,
            glbArraysByUrl,
            msg.fallbackColor,
          );
          resultArrays = fullResult.arrays;
          // Don't cache a prefix with no brush (degenerate member set) — the
          // incremental path would later fold onto a null base and crash.
          if (fullResult.preCreaseBrush) {
            membersPrefixCache.set(memberKey, { preCreaseBrush: fullResult.preCreaseBrush, key: memberKey });
            pruneCache("members");
          }
        }
      }
    } else {
      // Group kind
      const memberKey = getMemberKey("group", msg.members);
      const cachedEntry = groupPrefixCache.get(memberKey);

      if (cachedEntry) {
        resultArrays = evaluateCSGGroupGeometryFromArrays(
          msg.members,
          glbArraysByUrl,
          msg.isPhysics,
          msg.anchor,
          msg.anchorRotation,
        );
      } else {
        let bestPrefixEntry: CachedEntry | null = null;
        let bestPrefixKey = "";
        let newMember: ShapeType | null = null;
        let isHole = false;

        for (let len = msg.members.length - 1; len >= 1; len--) {
          const prefix = msg.members.slice(0, len);
          const prefixKey = getMemberKey("group", prefix);
          const prefixEntry = groupPrefixCache.get(prefixKey);
          if (prefixEntry) {
            if (msg.members.length === len + 1) {
              const candidate = msg.members[len];
              let matches = true;
              for (let i = 0; i < len; i++) {
                const oldM = prefix[i] as ShapeType;
                const newM = msg.members[i] as ShapeType;
                if (
                  oldM.id !== newM.id ||
                  oldM.type !== newM.type ||
                  oldM.url !== newM.url ||
                  oldM.position.join(",") !== newM.position.join(",") ||
                  oldM.rotation.join(",") !== newM.rotation.join(",") ||
                  oldM.scale.join(",") !== newM.scale.join(",") ||
                  oldM.color !== newM.color ||
                  oldM.isHole !== newM.isHole
                ) {
                  matches = false;
                  break;
                }
              }
              if (matches) {
                bestPrefixEntry = prefixEntry;
                bestPrefixKey = prefixKey;
                newMember = candidate;
                isHole = candidate.isHole ?? false;
                break;
              }
            }
          }
        }

        if (bestPrefixEntry && bestPrefixEntry.preCreaseBrush && newMember) {
          resultArrays = evaluateIncrementalCSG(
            sharedEvaluator,
            bestPrefixEntry.preCreaseBrush,
            newMember,
            glbArraysByUrl,
            true, // isGroupPath
            isHole,
            undefined,
            msg.isPhysics,
            msg.anchor,
            msg.anchorRotation,
          );
          const fullResult = evaluateCSGGroupGeometryFromArraysWithBrush(
            msg.members,
            glbArraysByUrl,
            msg.isPhysics,
            msg.anchor,
            msg.anchorRotation,
          );
          // Don't cache a prefix with no brush (group has no holes / no solids)
          // — the incremental path would later fold onto a null base and crash.
          if (fullResult.preCreaseBrush) {
            groupPrefixCache.set(memberKey, { preCreaseBrush: fullResult.preCreaseBrush, key: memberKey });
            pruneCache("group");
          }
        } else {
          const fullResult = evaluateCSGGroupGeometryFromArraysWithBrush(
            msg.members,
            glbArraysByUrl,
            msg.isPhysics,
            msg.anchor,
            msg.anchorRotation,
          );
          resultArrays = fullResult.arrays;
          // Don't cache a prefix with no brush (group has no holes / no solids)
          // — the incremental path would later fold onto a null base and crash.
          if (fullResult.preCreaseBrush) {
            groupPrefixCache.set(memberKey, { preCreaseBrush: fullResult.preCreaseBrush, key: memberKey });
            pruneCache("group");
          }
        }
      }
    }

    const evalElapsedMs = performance.now() - evalStart;

    const out: ResultMessage = {
      type: "result",
      id,
      positions: resultArrays.positions,
      normals: resultArrays.normals,
      colors: resultArrays.colors,
      uvs: resultArrays.uvs,
      indices: resultArrays.indices,
      evalElapsedMs,
    };

    const transferables: Transferable[] = [out.positions.buffer];
    if (out.normals.length > 0) transferables.push(out.normals.buffer);
    if (out.colors.length > 0) transferables.push(out.colors.buffer);
    if (out.uvs.length > 0) transferables.push(out.uvs.buffer);
    if (out.indices.length > 0) transferables.push(out.indices.buffer);

    (self as any).postMessage(out, transferables);
  } catch (err: any) {
    const out: ErrorMessage = { type: "error", id, error: err?.message || String(err) };
    (self as any).postMessage(out);
  }
};

// Cleanup function for testing (not used in production)
if (typeof self !== "undefined") {
  (self as any).__csgWorkerClearCaches = () => {
    clearCache("members");
    clearCache("group");
  };
}