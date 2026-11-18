# CSG add/subtract latency plan

**Problem:** when a user adds or subtracts (unions a shape into, or cuts a hole
out of) a CSG assembly, the new/edited result takes a noticeable time to appear.

**Goal:** shrink the time from "edit committed" to "new geometry on screen" for
the common case, and keep it bounded as member counts grow.

**Status:** proposal — not yet started. Incorporates the code-review corrections
from the first verification pass (crease/merge ordering, worker-side timing,
key-serialization scope, two-path split, transfer-vs-message distinction).

---

## Where the time actually goes

Today the flow is (all client-side):

1. **CadStudio commits the edit** — add/subtract changes `customMembers` (a
   member tree) or a `CSGGroup`'s `ShapeType[]` members.
2. **The worker recomputes the WHOLE boolean fold from scratch** —
   `evaluateCustomGeometry` / `evaluateCSGGroupGeometry` re-run *every*
   ADDITION and SUBTRACTION, in order, even though only one member changed.
   Each step is a full `three-bvh-csg` boolean (BVH construction + surface
   intersection + retessellation) — this is the dominant cost.
3. **Typed arrays are transferred back** to the main thread
   (`positions/normals/colors/uvs/indices`).
4. **Main thread rebuilds** a `BufferGeometry` via `arraysToGeometry` and swaps
   it into the mesh where visible.
5. **If dynamic/physics**, the new geometry is **re-voxelized** for its collider
   (`csgVoxelInput` → `VoxelCompoundColliders`), a second expensive pass.

Because step 2 runs off the main thread (a shared worker, `csgWorker.ts`), the UI
doesn't freeze — but the *time to first correct frame* is still the sum of 2+3+4,
and grows roughly linearly with member count × mesh resolution.

The existing `resultCache` (`useCSGWorker.ts`) only helps when you *revisit an
identical* member set — which an add/subtract edit never does. So every edit is a
full recompute.

---

## Guiding principle

**Reuse the previous result whenever the edit is *monotonic*** — i.e. the change
is a pure add (new solid unioned in) or pure subtract (new cutter subtracted).
Those are exactly the two operations the user described, and they are the only
ones that can be applied **incrementally** to a prior result instead of from
scratch.

A general "move/rotate a member" or a reorder is not monotonic and still needs a
full recompute — so this plan targets the add/subtract path first, which is both
the reported case and the cheapest to make fast.

---

## Two code paths, both in scope

The CSG system is **two separate fold algorithms** with distinct `kind`
discriminants in `csgWorker.ts`, and the incremental cache must handle **both
separately**:

- **`members` path** — `evaluateCustomGeometryFromArrays` →
  `evaluateCustomGeometry` (a single shape's nested `CustomMember[]` tree,
  driven by `CustomShapeMesh`). No `mergeVertices` pass.
- **`group` path** — `evaluateCSGGroupGeometryFromArrays` →
  `evaluateCSGGroupGeometry` (a `CSGGroup`'s flat `ShapeType[]` members; adds
  anchor-relative transform, hole-scale boost, and a `mergeVertices` pass).

They share no fold state and must carry independent prefix caches (see Step 1/2).

---

## The plan (in dependency order)

### Step 0 — Measure first (no code)

Add a wall-clock probe around a CSG request so the wins are measurable, not
impressionistic. The DEV telemetry already exists (`window.__csgProbe`,
`csgProbe.ts`) but records only `lastRequestAt`/`lastResolveAt` — **a full
round-trip**, not the worker-side fold cost. Worker-side elapsed time is a real
proto change:

- In `csgWorker.ts`, wrap the `evaluate*` call in `performance.now()` deltas and
  carry the elapsed value in `ResultMessage` (add `evalElapsedMs`).
- Add `evalElapsedMs` to `WorkerOutMessage` (`useCSGWorker.ts`) and to
  `CSGProbeEntry` (`csgProbe.ts`), so the probe can separate fold time from
  transfer/reconstruct time.

Record a baseline for representative scenes on **both** paths: 1 solid + 1 hole,
4 + 2, 8 + 4 (primitives, then one GLB member to cover the heavier path). Do not
skip — each step below claims a different ratio of the total and only measurement
proves it.

### Step 1 — Incremental monotonic fold (the main win)

When an edit is a **pure add or a pure subtract** relative to the cache's last
result, apply it to that result rather than restarting the fold.

The worker needs the previous fold result cached **as a live `Brush` /
`THREE.BufferGeometry`**:

- This cache is **worker-local** (a module-level variable in `csgWorker.ts`), so
  nothing crosses the thread boundary and there is no GPU-context concern — but
  the `Float32Array`/`Uint32Array` buffers behind it are real memory and must be
  bounded (see Step 2's eviction policy).
- On a request whose members are the previous set **plus one solid**: evaluate
  just `cachedBrush ∪ newSolid` (one ADDITION).
- Request = previous set **plus one hole**: evaluate `cachedBrush − newHole` (one
  SUBTRACTION).
- Anything else (member moved/rotated/scaled, reorder, two+ simultaneous changes,
  or a NESTED-custom-member change — see the key-scope warning) falls back to the
  current full fold.

#### ⚠️ Crease/merge ordering (the critical correctness issue)

The plan's first draft said the cached result could be the "pre-crease, pre-merge
geometry" because crease/merge happened "after the fold." **That is wrong for the
`group` path.** In `evaluateCSGGroupGeometry` (`geometryHelpers.ts:443-448`) the
`toCreasedNormals` crease **and** `mergeVertices` run *inside* the fold function,
and disposal happens after them — so the only geometry that survives is already
creased and merged.

Using an already-creased-and-merged geometry as the left-hand brush of the next
boolean is valid but **not equivalent** to the from-scratch result for that
prefix. Therefore:

- **The cached brush must be saved BEFORE `toCreasedNormals`/`mergeVertices`**
  run — i.e. save `res.geometry` right before the crease step, and only apply
  crease (`toCreasedNormals`) + merge (`mergeVertices`, group path only) to the
  **final** incremental result, not to the cached intermediate.
- This requires the fold functions to expose the pre-crease brush (or to return
  it alongside the final result), which is an implementation change to
  `geometryHelpers.ts` — not a pure "don't dispose it" change.

#### Equivalence test — use epsilon, not byte-identity

"Byte-identical arrays for [A, B]" is **too strict** unless the incremental path
reuses the *same* `Evaluator` instance. The `Evaluator` holds order-dependent BVH
state, so a fresh `new Evaluator()` yields geometrically-equivalent but not
bit-identical output. The test must:

- Keep the **same `Evaluator`** across the incremental steps (share it), and
- Compare vertex positions / indices within a **floating-point epsilon**, not raw
  array equality.

#### Cache-key scope warning (`serializeCustomMembers` does not recurse)

The existing `serializeCustomMembers` (`csgKeys.ts:17-25`) does **not** recurse
into a member's own nested `customMembers`. If the prefix-match key for Step 1/2
is derived from it, a change inside a nested custom sub-tree would be invisible to
the key and the incremental cache would wrongly treat an unchanged member as
unchanged. Options, choose one:

- Build a **fully recursive** serializer for the incremental-prefix key, or
- Treat any member whose `type === "custom"` as requiring a full-recompute
  fallback (conservative, simpler).

### Step 2 — Cache per-prefix step cost + bounded eviction

If Step 1 only caches the final brush, an edit sequence `A → A∪B → A∪B∪C` still
re-runs `A∪B` (as one op) each time. Cache the brush **after each fold step** keyed
on the canonical **prefix member set**, so a requested member set reuses the
longest common prefix instead of walking from the first member. This turns the
common add-most-recent pattern into `~O(1)` in member count.

- **Keying**: the prefix key must be the canonical serialized member subset (with
  the recursive serializer / nested-custom-guard from Step 1), **not** the full
  `computeKey` (which includes `anchor`, `arot`, `phys` — these must still route
  through the result cache correctly and are part of the geometry, so the prefix
  key should be scoped to the member set but the cached brush is only reusable
  when the transform-affecting inputs match too).
- **Eviction**: an unbounded worker cache of live brushes leaks memory. Use an
  LRU bounded to a modest count (e.g. 8–16 entries) per path, and clear the whole
  prefix cache on *any* full recompute (since a non-monotonic change invalidates
  every prefix that depended on it). State this explicitly.
- The correct analogy for this cache is **`resultCache` in `useCSGWorker.ts`**
  (module-level, keyed on serialized member set), *not* `geometryCache.ts`, which
  caches primitive geometries by type+detail and is unrelated to CSG results.

### Step 3 — Trim the transfer/reconstruct overhead

Independent of the fold cost:

- Result buffers are already transferred (`Transferable`) on the success path —
  do not regress that.
- **Distinguish message fields from transferables.** `csgWorker.ts:119-123`
  already *conditionally* pushes `normals/colors/uvs/indices` into `transferables`
  when non-empty, **but** they are still always present in the `out` object sent
  via `postMessage` — zero-length arrays still cross as message fields. Omit
  those fields from the message entirely when empty (guard in
  `arraysToGeometry`, which already handles their absence). Minor, but the first
  draft overstated the available win.
- Consider a **geometry cache** keyed on `computeKey` for the main-thread
  `arraysToGeometry` result, so a remount/undo that revisits a key skips
  step 4's reconstruction (complements `resultCache`, which keeps arrays).

### Step 4 — Defer / keep-old collider re-voxelization

After the geometry swaps in, the dynamic collider re-voxelizes (step 5 above)
before the shape is physically correct.

- **BUG-011 already fixed** the "previous colliders held across re-voxelization"
  case for `VoxelizedShapeBody`-style dynamic bodies, so the collider does not
  drop during a recompute. The remaining question is a **brief visual flash**
  during the swap — verify against `VoxelizedShapeBody.tsx` whether `CSGGroup`'s
  collider path has any residual holdover gap. The correct pattern to mirror is
  what `VoxelizedShapeBody.tsx` / BUG-011 does (hold the previous collider set
  across the recompute), **not** `StaleGeometryHold` (which `CSGGroup` does not
  use — it falls back to ungrouped members).
- Ensure re-voxelization is per-key cached (`csg-${depsKey}` already is), so
  undo/redo doesn't re-voxelize.

### Step 5 — Progressive display for genuinely large folds (larger effort)

For assemblies large enough that even one boolean visibly stutters the worker, a
final polish option: degrade gracefully by showing the **existing result until the
new one resolves** (already done for the mesh via `StaleGeometryHold` in
`CustomShapeMesh`, and via the ungrouped-members fallback in `CSGGroup`) and add a
small "computing…" affordance so the wait is legible instead of seeming frozen.
This is UX-only; Step 1 makes it rarely visible.

---

## Correctness / keying summary (what the first review flagged)

| Item | Decision |
|---|---|
| Cached brush location | worker-local live `Brush`/`BufferGeometry`; nothing crosses threads |
| Cached brush content | **pre-crease / pre-merge** geometry only (save before `toCreasedNormals`/`mergeVertices`); crease/merge the final result only |
| Equivalence test | same `Evaluator` reused + epsilon comparison, **not** byte-identity |
| Prefix key scope | fully-recursive serializer OR treat any nested-custom member change as full recompute |
| Cache eviction | per-path LRU (8–16), cleared on any non-monotonic full recompute |
| Correct analogy | `resultCache` in `useCSGWorker.ts`, not `geometryCache.ts` |
| Two paths | separate incremental caches for `members` and `group` kinds |

---

## What is deliberately out of scope

- Moving the *worker* code back to the main thread (off-thread keeps the UI alive
  during the fold; the problem is latency, not a freeze).
- Heavier CSG libraries / GPU boolean implementations — swap only if Step 1+2
  fail to reach the target.
- Multi-threaded parallelism within a single boolean op — `three-bvh-csg` is
  single-threaded per op; the shared worker already serializes groups.

---

## Verification

- `npm test` (Vitest) stays green. New/updated tests live in the **existing**
  `client/tests/csgEvaluation.test.ts` (273 lines, 8 cases covering both paths) —
  do not create a new test file. Add:
  - incremental-vs-full **epsilon** equivalence for both `members` and `group` paths,
  - prefix-cache reuse (matching even when a nested-custom member is guarded),
  - eviction does not drop correctness,
  - collider holdover (cross-check against `VoxelizedShapeBody`/BUG-011).
- Manual: in the app, add then subtract a shape to a multi-member CSG group on
  **both** a custom shape and a `CSGGroup`; confirm the visible swap time drops vs.
  the Step 0 baseline and the result is pixel-identical to today's.
- `npm run build` and `npm run lint` clean.

## Suggested ordering gate

```
STEP 0  baseline probe (+ evalElapsedMs protocol change)   (measure, no perf code)
STEP 1  incremental monotonic, TWO paths, pre-crease cache
        + epsilon equivalence tests                        (core win)
STEP 2  per-prefix step cache + LRU eviction               (builds on 1)
STEP 3  transfer/message-field + geometry-cache trim       (independent, small)
GATE    vitest + manual pixel-identical check + measured latency win
STEP 4  collider holdover gap fix (cross-check BUG-011)    (independent of 1–3)
STEP 5  progressive/progress UX                            (polish, optional)
```
