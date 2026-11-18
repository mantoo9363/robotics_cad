# Bug Audit — August 2026

**Date:** 2026-08-13
**Scope:** full codebase — `client/src`, 23,563 LOC across 60 TS/TSX files
**Method:** three ordered passes — (1) automated baseline, (2) targeted review of
known-risky physics/collider code, (3) general sweep
**Status of this document:** tracking. Findings are addressed by ID and retired in
place; see [Marking findings fixed](#marking-findings-fixed).
**Fix order:** findings are assigned to one of seven dependency-ordered phases, carried
on each entry's `Phase:` field and summarised in [Fix phases](#fix-phases).

## Totals

| Severity | Count | Definition used by this audit |
|---|---:|---|
| Critical | 18 | Crash, data loss, or silently wrong physics in a common/expected path |
| Moderate | 28 | Wrong behaviour in an edge case, or a measurable but non-blocking cost |
| Minor | 8 | Code quality, dead code, or a marker with no current user-facing impact |
| **Total** | **54** | |

> **Correction to the source report.** The published audit artifact's masthead states
> "41 findings · 11 critical · 21 moderate · 9 minor". That header was wrong — counting
> the report's actual finding rows gives 53 (17/28/8). This document is the corrected
> record. Severities are carried over from the audit verbatim and have **not** been
> re-judged.

## Resolution log

53 of 54 findings resolved. Regenerate this section with
`node docs/regen-resolution-log.mjs` after flipping any `Status:` line — it is
derived from the entries below, which are the source of truth. Nothing is ever
removed or renumbered; see [Marking findings fixed](#marking-findings-fixed).

| Phase | Fixed | Total | Progress |
|---|---:|---:|---|
| Phase 1 | 6 | 6 | `████████████████████` 6/6 |
| Phase 2 | 6 | 6 | `████████████████████` 6/6 |
| Phase 3 | 9 | 9 | `████████████████████` 9/9 |
| Phase 4 | 8 | 8 | `████████████████████` 8/8 |
| Phase 5 | 7 | 7 | `████████████████████` 7/7 |
| Phase 6 | 6 | 6 | `████████████████████` 6/6 |
| Phase 7 | 11 | 12 | `██████████████████░░` 11/12 |
| **All** | **53** | **54** | `████████████████████` 98% |

**No Critical findings remain open.**

### Resolved

| ID | Finding | Severity | § | Phase | Fixed | How |
|---|---|---|---|---:|---|---|
| BUG-001 | getBodyRef collapses two RigidBodies onto one ref, pr… | Critical | §A | 3 | 2026-08-13 | namespaced ref keys |
| BUG-002 | Chassis mass is read once, before async colliders exist | Critical | §A | 3 | 2026-08-13 | defer controller creation until mass > 0 |
| BUG-003 | getChassisWorldTransform feeds a live joint anchor, c… | Moderate | §A | 3 | 2026-08-13 | comment corrected; the usage was already sound |
| BUG-004 | Group body takes its origin from the centroid but its… | Moderate | §A | 3 | 2026-08-13 | group frame is now centroid + identity |
| BUG-005 | scaleMultiplier keys off a hardcoded shape id or a na… | Moderate | §A | 3 | 2026-08-13 | per-vehicle scale from its own wheel diameter |
| BUG-006 | The mass prop on `<RigidBody>` is a no-op | Moderate | §A | 3 | 2026-08-13 | no-op props removed + documented |
| BUG-007 | sortMotorGroups comparator is not a valid total order | Moderate | §A | 3 | 2026-08-13 | topological sort |
| BUG-008 | Motor pivot silently falls back to the world origin | Moderate | §A | 3 | 2026-08-13 | unresolvable pivot now skips the group |
| BUG-009 | Cache poisoning: a superseded request writes its resu… | Critical | §B | 4 | 2026-08-13 | request carries its own key; cache-hit cancels in-flight |
| BUG-010 | Worker error leaves the body permanently kinematic | Critical | §B | 4 | 2026-08-13 | worker error resolves as an empty result |
| BUG-011 | Re-voxelization drops every collider off a live dynam… | Critical | §B | 4 | 2026-08-13 | previous colliders held across re-voxelization |
| BUG-012 | lastKeyRef is never cleared after an error, so the sh… | Moderate | §B | 4 | 2026-08-13 | key cleared on error so a retry is possible |
| BUG-013 | Null voxelInput leaves the body permanently kinematic | Moderate | §B | 4 | 2026-08-13 | bounded grace period, then resolve as failed |
| BUG-014 | One dedicated Worker per component instance, with no… | Moderate | §B | 4 | 2026-08-13 | one shared worker, multiplexed by request id |
| BUG-015 | CSG group re-copies its entire geometry buffers on ev… | Moderate | §B | 4 | 2026-08-13 | solids/holes memoized on members |
| BUG-016 | Feature and bulk voxel grids emit overlapping boxes,… | Moderate | §B | 4 | 2026-08-13 | bulk box volume excludes the fine grid's coverage |
| BUG-017 | MemberCollider splits composite mass evenly, not by v… | Critical | §C | 5 | 2026-08-13 | volume-weighted, replacing the even split |
| BUG-018 | Torus volume formula has R and r swapped | Critical | §C | 5 | 2026-08-13 | 2*pi^2*R*r^2 |
| BUG-019 | Cylinder and cone colliders drop the Z scale | Moderate | §C | 5 | 2026-08-13 | non-uniform radial scale falls back to a real boundary |
| BUG-020 | Torus wedge mass fractions can sum to less than 1 | Moderate | §C | 5 | 2026-08-13 | share normalized across emitted wedges |
| BUG-021 | Cogwheel collider does not match its render mesh | Moderate | §C | 5 | 2026-08-13 | bevel included; bore corners circumscribed |
| BUG-022 | Cogwheel volume is computed as a solid cylinder | Moderate | §C | 5 | 2026-08-13 | summed wedge volumes, not a solid cylinder |
| BUG-023 | Static CSG TrimeshCollider ignores authored friction… | Minor | §C | 5 | 2026-08-13 | friction/restitution passed through |
| BUG-024 | Tier 1a and Tier 1b disagree on which body defines th… | Moderate | §D | 7 | 2026-08-13 | Tier 1b extrudes over the solid's extent, matching Tier 1a |
| BUG-025 | decomposeConcentricBore accepts an axially displaced… | Moderate | §D | 7 | 2026-08-13 | hole must actually span the solid, not just match its height |
| BUG-026 | BVH is disposed before the refinement loop, silently… | Moderate | §D | 7 | 2026-08-13 | BVH held for the whole pass; geometry released in finally |
| BUG-027 | Module patches global THREE prototypes on whatever th… | Moderate | §D | 7 | 2026-08-13 | uses MeshBVH directly; no global prototype patch at all |
| BUG-028 | Unreachable piece-count ceiling check | Minor | §D | 7 | 2026-08-13 | unreachable branch removed |
| BUG-029 | Voxelization member walkers recurse without a cycle g… | Critical | §E | 2 | 2026-08-13 | path-scoped cycle guard |
| BUG-030 | JSON.stringify memo key throws on a cyclic member tree | Critical | §E | 2 | 2026-08-13 | memo key now serializeMembers |
| BUG-031 | Collider and geometry member walkers recurse without… | Critical | §E | 2 | 2026-08-13 | cycle guard + MAX_COMPOSITE_DEPTH cap |
| BUG-032 | getRootGroupId walks the group tree in an unguarded w… | Moderate | §E | 2 | 2026-08-13 | seen-set guard |
| BUG-033 | Dead compound-collider builders, also unguarded | Minor | §E | 2 | 2026-08-13 | both functions removed, not guarded |
| BUG-034 | getCSGGroupCompoundColliders may derive its frame fro… | Minor | §E | 2 | 2026-08-13 | moot — see Related |
| BUG-035 | GlbShapeMesh disposes geometry it does not own | Critical | §F | 6 | 2026-08-13 | disposes only the cloned materials, never shared geometry |
| BUG-036 | CustomShapeMesh never disposes its CSG result geometry | Critical | §F | 6 | 2026-08-13 | cleanup effect disposes the previous CSG result |
| BUG-037 | evaluateCustomGeometry never disposes CSG intermediates | Critical | §F | 6 | 2026-08-13 | staleGeometries set, ported from CSGGroup |
| BUG-038 | Disposer effect captures a stale wrapper | Moderate | §F | 6 | 2026-08-13 | disposer effect now depends on wrapper |
| BUG-039 | GPU cleanup registry is keyed on shape.id alone | Moderate | §F | 6 | 2026-08-13 | registry holds a Set per shape id |
| BUG-040 | Thumbnail renderer mutates its input and never releas… | Moderate | §F | 6 | 2026-08-13 | wrapper-translated centring + URL-keyed cache |
| BUG-041 | No error boundary anywhere in the route tree | Critical | §G | 1 | 2026-08-13 | shared ErrorBoundary wrapping both routes |
| BUG-042 | `<Suspense>` does not catch load errors | Critical | §G | 1 | 2026-08-13 | boundary around each in-Canvas Suspense + DOM notice |
| BUG-043 | uploadModel fabricates a file path that will always 404 | Critical | §G | 1 | 2026-08-13 | uploads now stored as a data URL, not a fake server path |
| BUG-044 | Unguarded JSON.parse of cad-studio-paths crashes the… | Critical | §G | 1 | 2026-08-13 | shared readStoredJson guard for all four initialisers |
| BUG-045 | SSE frame handler parses JSON without a guard | Moderate | §G | 1 | 2026-08-13 | malformed SSE frames dropped with a counted warning |
| BUG-046 | Seven empty catch blocks swallow diagnostics | Minor | §G | 1 | 2026-08-13 | all seven catches now log with context |
| BUG-047 | Refs are read during render to position a grabbed shape | Moderate | §H | 7 | 2026-08-13 | grabbed state read from shape.grabbedBy, not a ref |
| BUG-048 | Keyboard nudge closes over stale workspace settings | Moderate | §H | 7 | 2026-08-13 | wsSettings added to the dependency array |
| BUG-049 | areKinematicNodePropsEqual omits eight compared fields | Moderate | §H | 7 | 2026-08-13 | comparator covers the eight omitted fields |
| BUG-050 | useCSGWorker has no sequence check, so stale results win | Moderate | §H | 7 | 2026-08-13 | useCSGWorker.ts + workers/csgWorker.ts removed |
| BUG-052 | @deprecated getBasicGeom is still on the live CSG path | Minor | §I | 7 | 2026-08-13 | deprecated alias removed; callers use getCachedGeometry |
| BUG-053 | Stale NOTE marker and stale AGENTS.md claims | Minor | §I | 7 | 2026-08-13 | AGENTS.md corrected; CadStudio NOTE left as accurate |
| BUG-054 | Sleeping chassis silently discards all vehicle engine… | Critical | §A | 3 | 2026-08-13 | canSleep={false} on vehicle chassis |

## Automated baseline results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Clean — 0 errors |
| Tests (pre-audit) | `npx vitest run` | 26/26 passing, 3 files |
| Lint | `npx eslint .` | 275 problems — 243 errors, 32 warnings |
| Lint (strict) | `tseslint.configs.strict` | 288 problems; adds only `no-non-null-assertion` (67 sites) |
| Dead-code analysis | — | No tool configured; skipped rather than adding a dependency |

The configured ruleset is `recommended` (js + typescript-eslint + react-hooks +
react-refresh). Lint totals are baseline debt, not findings — individual lint results
that *are* findings appear below with their own IDs.

## Repro tests

`client/tests/bugAuditRepro.test.ts` — 17 tests covering 8 of the 53 findings.

Each test asserts the **current, buggy** behaviour so the suite stays green today. When
a finding is fixed, flip or delete its test rather than leaving it asserting the old
behaviour. The file's `describe` blocks are named with the audit's original `F-nn`
labels; renaming them would be a code change and is out of scope for this document,
which is why the [ID mapping](#id-mapping) below is required.

```
$ cd client && npx vitest run
 Test Files  4 passed (4)
      Tests  43 passed (43)
```

## Line-reference validity

⚠️ **Line numbers in this document refer to an uncommitted working tree** (last commit
`c3441ab`, 2026-08-10, plus staged/unstaged audit-era changes). They were accurate at
the time of writing — eight were spot-checked against the live files and all landed
exactly on the cited code — but they **will drift** as soon as any listed file is
edited.

No finding is flagged `needs re-verification` at creation time. If you find a reference
that no longer matches, mark it `needs re-verification` on that entry rather than
silently updating it.

## ID mapping

The audit used ad-hoc `F-nn` labels. This document renumbers to `BUG-nnn` in document
order (by section, then Critical → Moderate → Minor). Use `BUG-nnn` in commits and
follow-up prompts; use this table to trace back to the report or the repro tests.

| Audit | This doc | Audit | This doc | Audit | This doc |
|---|---|---|---|---|---|
| F-01 | BUG-018 | F-19 | BUG-011 | F-37 | BUG-046 |
| F-02 | BUG-019 | F-20 | BUG-012 | F-38 | BUG-035 |
| F-03 | BUG-020 | F-21 | BUG-013 | F-39 | BUG-036 |
| F-04 | BUG-021 | F-22 | BUG-014 | F-40 | BUG-037 |
| F-05 | BUG-025 | F-23 | BUG-015 | F-41 | BUG-038 |
| F-06 | BUG-029 | F-24 | BUG-017 | F-42 | BUG-039 |
| F-07 | BUG-016 | F-25 | BUG-024 | F-43 | BUG-040 |
| F-08 | BUG-001 | F-26 | BUG-026 | F-44 | BUG-048 |
| F-09 | BUG-002 | F-27 | BUG-022 | F-45 | BUG-007 |
| F-10 | BUG-003 | F-28 | BUG-030 | F-46 | BUG-008 |
| F-11 | BUG-004 | F-29 | BUG-031 | F-47 | BUG-049 |
| F-12 | BUG-032 | F-30 | BUG-033 | F-48 | BUG-028 |
| F-13 | BUG-005 | F-31 | BUG-041 | F-49 | BUG-034 |
| F-14 | BUG-047 | F-32 | BUG-042 | F-50 | BUG-051 |
| F-15 | BUG-006 | F-33 | BUG-043 | F-51 | BUG-027 |
| F-16 | BUG-023 | F-34 | BUG-044 | F-52 | BUG-052 |
| F-17 | BUG-009 | F-35 | BUG-045 | F-53 | BUG-053 |
| F-18 | BUG-010 | F-36 | BUG-050 | | |

## Sections

| § | Section | Critical | Moderate | Minor | Total |
|---|---|---:|---:|---:|---:|
| [A](#a--vehicle-physics--joint-anchoring) | Vehicle Physics & Joint Anchoring | 3 | 6 | 0 | 9 |
| [B](#b--voxel-collider-worker--kinematic-hold) | Voxel Collider Worker & Kinematic Hold | 3 | 5 | 0 | 8 |
| [C](#c--collider-mass-inertia--shape-fidelity) | Collider Mass, Inertia & Shape Fidelity | 2 | 4 | 1 | 7 |
| [D](#d--bore-decomposers-tier-1a--1b) | Bore Decomposers (Tier 1a / 1b) | 0 | 4 | 1 | 5 |
| [E](#e--csg-member-tree-traversal--cycle-safety) | CSG Member-Tree Traversal & Cycle Safety | 3 | 1 | 2 | 6 |
| [F](#f--glb-loading-disposal--gpu-memory) | GLB Loading, Disposal & GPU Memory | 3 | 3 | 0 | 6 |
| [G](#g--error-handling--crash-chains) | Error Handling & Crash Chains | 4 | 1 | 1 | 6 |
| [H](#h--react-render-correctness--stale-state) | React Render Correctness & Stale State | 0 | 4 | 0 | 4 |
| [I](#i--dead-code--documentation-debt) | Dead Code & Documentation Debt | 0 | 0 | 3 | 3 |
| | **Total** | **18** | **28** | **8** | **54** |

Each finding has exactly one primary section. Anything relevant to more than one is
cross-referenced via its `Related:` field.

Three findings were deliberately re-homed away from the audit's own pass structure, so
that a fix pass touches one section rather than three:

- **BUG-007** and **BUG-008** moved from the audit's "stale closures" pass into §A —
  both are motor-group resolution bugs that belong beside the joint findings.
- **BUG-032** moved from the vehicle pass into §E — it is a missing-cycle-guard
  finding and should be fixed with the same `seen`-set pattern as the other walkers.
- **BUG-027** moved from "TODO markers" into §D — it is a live blocker on wiring
  Tier 1b in, not a stray comment.

## Fix phases

Sections above group findings by *where they live*. Phases group them by *what order to
fix them in* — dependency- and risk-ordered, deliberately **not** by severity. A phase
cuts across sections; every finding carries a `Phase:` field so the two views stay
consistent.

Phases 3 and 4, and the BUG-017 portion of Phase 5, are flagged as needing their own
plan-then-prompt pass before a fix is attempted — the same treatment the vehicle-joint
and Tier 1a/1b work each received. The rest are direct-fix.

| Phase | Name | Findings | Crit | Mod | Min | Own planning pass? |
|---:|---|---:|---:|---:|---:|:---:|
| [1](#phase-1--safety-net-crash-containment) | Safety net (crash containment) | 6 | 4 | 1 | 1 | No |
| [2](#phase-2--cycle-guard-sweep-one-coordinated-fix) | Cycle-guard sweep | 6 | 3 | 1 | 2 | No |
| [3](#phase-3--vehicle--joint-cluster) | Vehicle / joint cluster | 8 | 2 | 6 | 0 | **Yes** |
| [4](#phase-4--voxel-worker-cluster) | Voxel worker cluster | 8 | 3 | 5 | 0 | **Yes** |
| [5](#phase-5--massinertia-consistency) | Mass / inertia consistency | 7 | 2 | 4 | 1 | **BUG-017 only** |
| [6](#phase-6--glb-loading--disposal) | GLB loading & disposal | 6 | 3 | 3 | 0 | No |
| [7](#phase-7--not-yet-live-cleanup) | Not-yet-live cleanup | 12 | 0 | 8 | 4 | No |
| | **Total** | **53** | **17** | **28** | **8** | |

### Phase 1 — Safety net (crash containment)

**Own planning pass:** No — small, well-understood changes.

An error boundary and guarded parsing change the failure mode of every other bug. Do
this first so nothing else can blank the whole app while later phases are in progress.

- [BUG-041](#bug-041--no-error-boundary-anywhere-in-the-route-tree) — No error boundary anywhere in the route tree · *Critical*
- [BUG-042](#bug-042--suspense-does-not-catch-load-errors) — `<Suspense>` does not catch load errors · *Critical*
- [BUG-043](#bug-043--uploadmodel-fabricates-a-file-path-that-will-always-404) — `uploadModel` fabricates a file path that will always 404 · *Critical*
- [BUG-044](#bug-044--unguarded-jsonparse-of-cad-studio-paths-crashes-the-simulation-page) — Unguarded `JSON.parse` of `cad-studio-paths` · *Critical*
- [BUG-045](#bug-045--sse-frame-handler-parses-json-without-a-guard) — SSE frame handler parses JSON without a guard · *Moderate*
- [BUG-046](#bug-046--seven-empty-catch-blocks-swallow-diagnostics) — Seven empty `catch` blocks swallow diagnostics · *Minor*

### Phase 2 — Cycle-guard sweep (one coordinated fix)

**Own planning pass:** No — the pattern is already established in the codebase.

All six are missing the same `seen`-set guard;
`client/src/components/canvas/utils/GrabbingSystem.ts:394-413` is the template. Fix
together, not one at a time, per the audit's own recommendation.

- [BUG-029](#bug-029--voxelization-member-walkers-recurse-without-a-cycle-guard) — Voxelization member walkers recurse without a cycle guard · *Critical*
- [BUG-030](#bug-030--jsonstringify-memo-key-throws-on-a-cyclic-member-tree) — `JSON.stringify` memo key throws on a cyclic member tree · *Critical*
- [BUG-031](#bug-031--collider-and-geometry-member-walkers-recurse-without-a-cycle-guard) — Collider and geometry member walkers recurse without a cycle guard · *Critical*
- [BUG-032](#bug-032--getrootgroupid-walks-the-group-tree-in-an-unguarded-while-true) — `getRootGroupId` walks the group tree in an unguarded `while (true)` · *Moderate*
- [BUG-033](#bug-033--dead-compound-collider-builders-also-unguarded) — Dead compound-collider builders, also unguarded · *Minor*
- [BUG-034](#bug-034--getcsggroupcompoundcolliders-may-derive-its-frame-from-a-hole-member) — `getCSGGroupCompoundColliders` may derive its frame from a hole member · *Minor*

### Phase 3 — Vehicle / joint cluster

**Own planning pass: Yes.**

BUG-001 is the leading root-cause candidate for the previously-open vehicle bug —
confirm and isolate it first, then address BUG-002 through BUG-008 together, since they
touch the same joint / motor-wiring code.

- [BUG-001](#bug-001--getbodyref-collapses-two-rigidbodies-onto-one-ref-producing-a-degenerate-self-joint) — `getBodyRef` collapses two RigidBodies onto one ref · *Critical*
- [BUG-002](#bug-002--chassis-mass-is-read-once-before-async-colliders-exist) — Chassis mass is read once, before async colliders exist · *Critical*
- [BUG-003](#bug-003--getchassisworldtransform-feeds-a-live-joint-anchor-contradicting-its-own-safety-comment) — `getChassisWorldTransform` feeds a live joint anchor · *Moderate*
- [BUG-004](#bug-004--group-body-takes-its-origin-from-the-centroid-but-its-rotation-from-the-first-member) — Group body mixes centroid origin with first-member rotation · *Moderate*
- [BUG-005](#bug-005--scalemultiplier-keys-off-a-hardcoded-shape-id-or-a-name-containing-wheel) — `scaleMultiplier` keys off a hardcoded id or a "wheel" name · *Moderate*
- [BUG-006](#bug-006--the-mass-prop-on-rigidbody-is-a-no-op) — The `mass` prop on `<RigidBody>` is a no-op · *Moderate*
- [BUG-007](#bug-007--sortmotorgroups-comparator-is-not-a-valid-total-order) — `sortMotorGroups` comparator is not a valid total order · *Moderate*
- [BUG-008](#bug-008--motor-pivot-silently-falls-back-to-the-world-origin) — Motor pivot silently falls back to the world origin · *Moderate*

### Phase 4 — Voxel worker cluster

**Own planning pass: Yes.**

BUG-009, BUG-010 and BUG-011 are three interacting state-machine bugs in one hook — the
audit explicitly warns that fixing one in isolation risks masking the others. Bundle the
rest of the same hook / worker area into the same pass.

- [BUG-009](#bug-009--cache-poisoning-a-superseded-request-writes-its-result-under-the-wrong-key) — Cache poisoning: superseded request writes under the wrong key · *Critical*
- [BUG-010](#bug-010--worker-error-leaves-the-body-permanently-kinematic) — Worker error leaves the body permanently kinematic · *Critical*
- [BUG-011](#bug-011--re-voxelization-drops-every-collider-off-a-live-dynamic-body) — Re-voxelization drops every collider off a live dynamic body · *Critical*
- [BUG-012](#bug-012--lastkeyref-is-never-cleared-after-an-error-so-the-shape-never-retries) — `lastKeyRef` never cleared after an error, so the shape never retries · *Moderate*
- [BUG-013](#bug-013--null-voxelinput-leaves-the-body-permanently-kinematic) — Null `voxelInput` leaves the body permanently kinematic · *Moderate*
- [BUG-014](#bug-014--one-dedicated-worker-per-component-instance-with-no-pool) — One dedicated `Worker` per component instance, with no pool · *Moderate*
- [BUG-015](#bug-015--csg-group-re-copies-its-entire-geometry-buffers-on-every-render) — CSG group re-copies its geometry buffers on every render · *Moderate*
- [BUG-016](#bug-016--feature-and-bulk-voxel-grids-emit-overlapping-boxes-double-counting-volume) — Feature and bulk voxel grids emit overlapping boxes · *Moderate*

### Phase 5 — Mass / inertia consistency

**Own planning pass: BUG-017 only** — the rest are direct fixes once that decision is
made.

BUG-017 (equal-split vs. volume-weighted) breaks documented legacy parity and needs a
decision before an edit. The rest are same-theme shape-fidelity and mass bugs that can
go in the same pass.

- [BUG-017](#bug-017--membercollider-splits-composite-mass-evenly-not-by-volume) — `MemberCollider` splits composite mass evenly, not by volume · *Critical* · **needs a decision first**
- [BUG-018](#bug-018--torus-volume-formula-has-r-and-r-swapped) — Torus volume formula has R and r swapped · *Critical*
- [BUG-019](#bug-019--cylinder-and-cone-colliders-drop-the-z-scale) — Cylinder and cone colliders drop the Z scale · *Moderate*
- [BUG-020](#bug-020--torus-wedge-mass-fractions-can-sum-to-less-than-1) — Torus wedge mass fractions can sum to less than 1 · *Moderate*
- [BUG-021](#bug-021--cogwheel-collider-does-not-match-its-render-mesh) — Cogwheel collider does not match its render mesh · *Moderate*
- [BUG-022](#bug-022--cogwheel-volume-is-computed-as-a-solid-cylinder) — Cogwheel volume is computed as a solid cylinder · *Moderate*
- [BUG-023](#bug-023--static-csg-trimeshcollider-ignores-authored-friction-and-restitution) — Static CSG `TrimeshCollider` ignores authored friction/restitution · *Minor*

### Phase 6 — GLB loading & disposal

**Own planning pass:** No — urgent but not complex.

BUG-035 is urgent (cross-instance breakage: deleting one GLB shape corrupts every other
instance of that file) but the fix is targeted. Bundle it with the rest of the same
disposal machinery.

- [BUG-035](#bug-035--glbshapemesh-disposes-geometry-it-does-not-own) — `GlbShapeMesh` disposes geometry it does not own · *Critical*
- [BUG-036](#bug-036--customshapemesh-never-disposes-its-csg-result-geometry) — `CustomShapeMesh` never disposes its CSG result geometry · *Critical*
- [BUG-037](#bug-037--evaluatecustomgeometry-never-disposes-csg-intermediates) — `evaluateCustomGeometry` never disposes CSG intermediates · *Critical*
- [BUG-038](#bug-038--disposer-effect-captures-a-stale-wrapper) — Disposer effect captures a stale wrapper · *Moderate*
- [BUG-039](#bug-039--gpu-cleanup-registry-is-keyed-on-shapeid-alone) — GPU cleanup registry is keyed on `shape.id` alone · *Moderate*
- [BUG-040](#bug-040--thumbnail-renderer-mutates-its-input-and-never-releases-gpu-memory) — Thumbnail renderer mutates its input and never releases GPU memory · *Moderate*

### Phase 7 — Not-yet-live cleanup

**Own planning pass:** No — though BUG-024 through BUG-028 are gated on the Tier 1b
wiring decision, which is its own separate piece of work.

The Tier 1a/1b findings should be resolved *alongside* the Tier 1b wiring decision, not
before it — BUG-027 is itself part of that decision. The React render-correctness and
dead-code / doc-debt findings have no current user-facing impact, so they are lowest
urgency.

- [BUG-024](#bug-024--tier-1a-and-tier-1b-disagree-on-which-body-defines-the-extrusion-frame) — Tier 1a and Tier 1b disagree on the extrusion frame · *Moderate*
- [BUG-025](#bug-025--decomposeconcentricbore-accepts-an-axially-displaced-hole) — `decomposeConcentricBore` accepts an axially displaced hole · *Moderate*
- [BUG-026](#bug-026--bvh-is-disposed-before-the-refinement-loop-silently-falling-back-to-brute-force) — BVH disposed before the refinement loop · *Moderate*
- [BUG-027](#bug-027--module-patches-global-three-prototypes-on-whatever-thread-imports-it) — Module patches global `THREE` prototypes on the importing thread · *Moderate* · **part of the Tier 1b wiring decision**
- [BUG-028](#bug-028--unreachable-piece-count-ceiling-check) — Unreachable piece-count ceiling check · *Minor*
- [BUG-047](#bug-047--refs-are-read-during-render-to-position-a-grabbed-shape) — Refs read during render to position a grabbed shape · *Moderate*
- [BUG-048](#bug-048--keyboard-nudge-closes-over-stale-workspace-settings) — Keyboard nudge closes over stale workspace settings · *Moderate*
- [BUG-049](#bug-049--arekinematicnodepropsequal-omits-eight-compared-fields) — `areKinematicNodePropsEqual` omits eight compared fields · *Moderate*
- [BUG-050](#bug-050--usecsgworker-has-no-sequence-check-so-stale-results-win) — `useCSGWorker` has no sequence check, so stale results win · *Moderate*
- [BUG-051](#bug-051--67-non-null-assertions-on-lookups-that-are-not-statically-guaranteed) — 67 non-null assertions on unguaranteed lookups · *Minor*
- [BUG-052](#bug-052--deprecated-getbasicgeom-is-still-on-the-live-csg-path) — `@deprecated getBasicGeom` is still on the live CSG path · *Minor*
- [BUG-053](#bug-053--stale-note-marker-and-stale-agentsmd-claims) — Stale `NOTE` marker and stale `AGENTS.md` claims · *Minor*

## Marking findings fixed

IDs are permanent. To retire a finding:

1. Change its `Status:` line from `Open` to `Fixed YYYY-MM-DD — <commit or PR ref>`.
2. Append it to the `Fixed since this audit` note at the top of its section.
3. Flip or delete its repro test in `bugAuditRepro.test.ts`, if it has one.

Never renumber, never delete an entry. A superseded finding gets
`Status: Withdrawn — <reason>` instead.

---

# A — Vehicle Physics & Joint Anchoring

> **Fixed since this audit:** BUG-001, BUG-003, BUG-004, BUG-006, BUG-007, BUG-008
> (all 2026-08-13, Phase 3 session). **Still open: BUG-002 and BUG-005**, both gated
> behind Gate C — they change the quantities a driving test measures, so they must not
> move while one is in flight. See [phase-3-plan.md](./phase-3-plan.md).
>
> **Phase 3 is complete** — all 8 original findings plus BUG-054, found mid-phase.
> BUG-005's fix is a no-op for the demo car by construction (its mean wheel
> diameter is 5.5, giving the same 4.583 the old heuristic produced), which is why
> the e2e drive numbers are unchanged.
>
> **BUG-054 found and fixed 2026-08-13** — [sleeping chassis discards all engine force](#bug-054--sleeping-chassis-silently-discards-all-vehicle-engine-force).
> Found by the stop/idle/resume sequence Gate A never ran; **pre-existing, not a
> Phase 3 regression**, proven by reverting BUG-004/006 and re-measuring. Now covered
> by `npm run test:e2e`, which drives the real app in Chrome.
>
> Two of these were not the fix the audit anticipated:
> - **BUG-003** turned out to be a **stale comment, not an unsafe usage.** The
>   anchors it feeds are set once at joint creation and never mutated, and the frames
>   genuinely agree. The comment now states the real invariant (frame agreement)
>   rather than the incidental one (liveness). No behavioural change.
> - **BUG-004**'s real defect was not that the frame *mixes* centroid and rotation —
>   every consumer used the same frame consistently — but that `memberTransforms[0]`
>   made it depend on **array order**, the same class as BUG-001. Standardised on
>   centroid + identity, which is order-invariant by construction.

> ### Gate A result — the original traction bug is closed by replacement
>
> **Verified 2026-08-13: the traction bug (drive wheels spin, car does not translate)
> does not reproduce on the current working tree.** Recording the mechanism here,
> because it otherwise exists only in an uncommitted diff:
>
> | | `HEAD` (c3441ab) | Working tree |
> |---|---|---|
> | Wheel drive | `SimulationMotorJoint` → `useRevoluteJoint(chassisRef, wheelRef, …)` | `RaycastVehicle` (raycast controller) |
> | Wheel bodies | own `RigidBody` per wheel | none — plain visual `<group>`, no collider |
> | `useRevoluteJoint` call sites | wheels **and** custom motors | custom motors only |
>
> The joint-based wheel system the reverted investigation was trying to fix was
> **replaced**, not repaired — see `SimulationScene.tsx:484-494`. The chassis
> group-origin/joint-anchor mismatch and the compound-chassis inertia-tensor
> instability had no host left in the vehicle path, and no re-attempt at either is
> scheduled. If a traction symptom ever returns it should be treated as a **new**
> bug with a new mechanism, not a resumption of that investigation.
>
> **BUG-001 was NOT that bug.** It does not reproduce in the demo car on two
> independent grounds: no shape in that scene satisfies its condition (all six driven
> members are standalone — they never receive `parentId`), and the scene instantiates
> `CustomRevoluteMotor` zero times, so the self-joint mechanism has nothing to act on.
> It was fixed on its own merits as a latent bug affecting grouped custom-motor rigs.

The `RaycastVehicle` / revolute-joint / body-reference cluster.

#### BUG-001 — `getBodyRef` collapses two RigidBodies onto one ref, producing a degenerate self-joint

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 3 session (namespaced ref keys)
- **Phase:** 3
- **Audit ID:** F-08
- **Files:** `client/src/components/canvas/SimulationScene.tsx:718-743` (`getBodyRef`),
  `:1024` (`unGroupedShapes`), `:1037` (`groupMapping`), `:1842-1897` (`CustomRevoluteMotor` wiring)
- **Description:** A motor group's driven member renders its own standalone
  `RigidBody` keyed on its own id, while every other shape in the same group keys on
  `shapes.filter(parented-into-root)[0]` — a list that still *contains* that driven
  member. When the driven member comes first in the `shapes` array, the compound group
  body and the member's standalone body are handed the same React ref, and
  `useRevoluteJoint(pivotRef, shapeRef, …)` then receives the same body for both
  anchors. A body jointed to itself is a degenerate constraint and Rapier's solver
  diverges on it regardless of how correct the anchor offsets are.
- **Trigger:** Any non-vehicle motor group whose driven shape is parented into a group
  and appears before the pivot shape in the `shapes` array. Purely ordering-dependent,
  which is consistent with the bug appearing and disappearing between scenes.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-08 / BUG-001` (6 tests, flipped
  2026-08-13 from asserting the collision to asserting the fix): a **control** showing
  the old scheme collided on exactly one array ordering, distinct refs under the new
  scheme, order-independence, preservation of the one-body-per-group behaviour, and a
  guard confirming the demo car is unaffected.
- **Live-scene check (Gate A):** does **not** reproduce in the demo car — see the
  section note above. Confirmed by transcribing `confirmLoadDemoCar`
  (`CadStudio.tsx:2337-2653`) and running it through the real resolver logic.
- **Suspected fix:** Needs a dedicated planning pass. The ref-keying scheme itself is
  the problem, not the anchor arithmetic — worth confirming this reproduces in the live
  scene before any further anchor work, since if it holds the previously-reverted anchor
  fixes may have been correct all along.
- **Related:** BUG-003 (the other live-joint-anchor concern), BUG-004 (group frame).

#### BUG-054 — Sleeping chassis silently discards all vehicle engine force

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 3 session (canSleep={false} on vehicle chassis)
- **Phase:** 3
- **Audit ID:** — (found 2026-08-13, after the original audit)
- **Files:** `client/src/components/canvas/SimulationScene.tsx` (`RaycastVehicle`,
  the `useBeforePhysicsStep` body — no `wakeUp()` anywhere in it); the group and
  standalone `<RigidBody>` elements, which never set `canSleep`
- **Description:** Rapier's `canSleep` defaults to true and the app never overrides
  it, so a stationary chassis falls asleep once it settles. `RaycastVehicle` never
  calls `wakeUp()` on the chassis, and `controller.updateVehicle()` does **not** wake
  its own chassis either — so every newton of engine force applied afterwards is
  silently discarded.
- **Why the wheels appear to spin:** the sleeping body still *accumulates* the
  controller's applied velocity — stored on the body, never integrated into position,
  never damped. `rollAngleRef` derives wheel roll from `forward · linvel`, so it reads
  that bogus, monotonically growing velocity and spins the wheel meshes faster and
  faster while the chassis sits perfectly still. That is the reported "wheels spin
  freely and the car does not translate", exactly.
- **Broader than the reported trigger:** browser measurement shows the standing-start
  drive fails too, once the car has been left alone long enough to sleep (~9s after
  entering the simulation suffices). Stop/idle/resume is simply the sequence a user
  notices; the real condition is "the chassis has come to rest".
- **Trigger:** The chassis coming to rest for long enough to sleep — after which any
  drive input is ignored. Stop / idle / resume is the sequence a user hits, but a
  standing start reproduces it too if the car has been sitting since load. Gate A
  missed it by driving immediately, while the car was still settling and awake.
- **Evidence:** two independent repros, both automated.
  1. `client/tests/vehicleIdleResume.test.ts` — headless Rapier, no browser.
     First drive moves 10.56 units; after idling to sleep the resume drive moves
     **0.00**. The isolating probe differs by a single `wakeUp()` call and nothing
     else: `withoutWake=0.00`, `withWake=16.86`.
  2. `client/e2e/driveDemoCar.mjs` (`npm run test:e2e`) — drove the **real app** in
     Chrome over the DevTools Protocol. Confirmed it end to end: `sleptWhileIdle=true`,
     chassis `moved=0.00`, `wheelRollDelta=30.64` — the wheels visibly spin while the
     car does not move. Waking the body from the page and driving in the same breath
     moved it **13.63 units**, restoring normal behaviour. (Historical: the `e2e/`
     harness this ran against has since been removed — see AGENTS.md — so this repro
     is no longer runnable as-is; the headless Rapier repro above still is.)
- **Regression check:** **pre-existing, not a Phase 3 regression.** Verified by
  reverting BUG-004 and BUG-006 — the only two Phase 3 fixes that touch the vehicle
  path — and re-running the browser repro: identical failure (`moved=0.000`,
  `sleeping=true`). BUG-003 is comment-only, and `SimulationScene` imports neither
  `kinematicsUtils` nor `KinematicNode`, so BUG-007/BUG-008 cannot reach it. Gate B
  passed earlier because it drove immediately after load, before the chassis had
  settled long enough to sleep.
- **Fix applied:** `canSleep={false}` on the vehicle-chassis `<RigidBody>`, on both
  the standalone and compound-group paths (`!isChassis`). Verified that `canSleep`
  genuinely reaches Rapier — `rigidBodyDescFromOptions` does apply it, unlike `mass`
  (BUG-006).

  Chosen over waking the chassis on input because it **prevents** the bad state
  rather than recovering from it. A sleeping body accumulates the controller's
  applied velocity without integrating it — telemetry showed it climbing past 47 —
  so a wake-on-input fix would also have to discard that pent-up velocity or the car
  would launch. A body that never sleeps integrates continuously and stays bounded by
  drag. Cost is one non-sleeping body per vehicle.

  Measured after the fix (`npm run test:e2e`, 6/6 green): standing-start drive
  **14.45** units (was 0.00), resume after idle **14.32** (was 0.00), and
  `wheelRollDelta` back to 5.21 — proportional to real motion instead of the runaway
  30.64. Resume after a **30s** idle still moves 14.73. Parked drift over 25s is
  **0.0000**, so the never-sleeping body does not creep or jitter. Steering
  unaffected.
- **Related:** BUG-002 (also `RaycastVehicle` controller setup — **ruled out** as a
  cause here; the controller is created once and idle does not re-run it).
#### BUG-002 — Chassis mass is read once, before async colliders exist

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 3 session (defer controller creation until mass > 0)
- **Phase:** 3
- **Audit ID:** F-09
- **Files:** `client/src/components/canvas/SimulationScene.tsx:571-579`
- **Description:** `chassisMass = chassisRef.current.mass()` is read a single time, at
  the first physics tick on which the chassis ref exists. If the chassis's colliders are
  still resolving in the voxel worker, mass reads as approximately zero and
  `setWheelMaxSuspensionForce` falls back to its hard `5000` floor for the entire life
  of the vehicle controller. It is never re-read once the real colliders arrive.
- **Trigger:** Chassis is a hollow CSG group or a concave GLB — i.e. anything on the
  voxel path. The vehicle sits low, bottoms out, or sinks at rest, and nothing logs.
- **Evidence:** Static/read-only finding, no repro test. Confirmed by reading the
  controller-creation branch and the `VoxelCompoundColliders` mount timing.
- **Suspected fix:** Re-read chassis mass and re-apply suspension force once colliders
  resolve, or defer controller creation until the chassis reports non-zero mass.
- **Related:** BUG-009, BUG-010, BUG-011 (the async collider timing this depends on).

#### BUG-003 — `getChassisWorldTransform` feeds a live joint anchor, contradicting its own safety comment

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 3 session (comment corrected; the usage was already sound)
- **Phase:** 3
- **Audit ID:** F-10
- **Files:** `client/src/components/canvas/SimulationScene.tsx:1150-1167` (definition
  and comment), `:1844-1845` (use), `:1886-1897` (`anchor1` computation)
- **Description:** The function's own comment states it is safe "specifically because
  it only ever feeds a one-time `RaycastVehicle` wheel config, never a live joint anchor
  that gets mutated at runtime". Line 1845 uses it to compute `CustomRevoluteMotor`'s
  `anchor1`, which is exactly a live joint anchor. Either the comment is stale or the
  previously-reverted unsafe pattern re-entered through the custom-motor path.
- **Trigger:** Any custom motor whose pivot shape belongs to a group.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Determine which of the two is true before changing anything — if
  the comment is the stale part, update it; if the constraint is real, the custom-motor
  path needs its own anchor derivation. Best resolved alongside BUG-001.
- **Related:** BUG-001 (same joint-wiring code path).

#### BUG-004 — Group body takes its origin from the centroid but its rotation from the first member

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 3 session (group frame is now centroid + identity)
- **Phase:** 3
- **Audit ID:** F-11
- **Files:** `client/src/components/canvas/SimulationScene.tsx:1113-1148`
  (`initialGroupTransforms`), `:1636` (`rotation` prop)
- **Description:** A compound group's `RigidBody` origin is the member *centroid*, but
  its orientation is `memberTransforms[0].rotation` — the first member's, selected by
  array order. Position and rotation therefore come from two different reference frames,
  and the resulting body frame matches neither the centroid nor any single member.
- **Trigger:** A compound chassis whose members are not all authored at the same
  rotation.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Derive both from the same frame — either an identity rotation with
  centroid origin, or a properly averaged//principal-axis orientation.
- **Related:** BUG-001, BUG-003 (all three concern the group body's reference frame).

#### BUG-005 — `scaleMultiplier` keys off a hardcoded shape id or a name containing "wheel"

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 3 session (per-vehicle scale from its own wheel diameter)
- **Phase:** 3
- **Audit ID:** F-13
- **Files:** `client/src/components/canvas/SimulationScene.tsx:690-696`
- **Description:** `scaleMultiplier` — which scales engine force, brake force and motor
  torque by its *cube* — is derived from the first shape with `id === 1002` **or** a
  name containing "wheel". A user naming any shape "Wheel guard" silently re-scales the
  whole vehicle's forces by (that shape's X scale ÷ 1.2)³.
- **Trigger:** Any scene without the demo car's shape 1002 but containing a
  wheel-named shape. Also any scene with neither, which falls back to `1.0` and
  under-powers a scaled-up vehicle.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Derive the multiplier from actual vehicle wheel configs
  (`vehicleConfigs[].wheels[].radius`) rather than an id/name heuristic.
- **Related:** —

#### BUG-006 — The `mass` prop on `<RigidBody>` is a no-op

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 3 session (no-op props removed + documented)
- **Phase:** 3
- **Audit ID:** F-15
- **Files:** `@react-three/rapier` v2.2.0 (library behaviour); consumed throughout
  `client/src/components/canvas/SimulationScene.tsx`,
  `client/src/components/canvas/VoxelizedShapeBody.tsx`
- **Description:** Verified in the library source: `rigidBodyDescFromOptions` applies
  only `type` and `canSleep`; `mutableRigidBodyOptions` has no `mass` handler; and
  `cleanRigidBodyPropsForCollider` explicitly *strips* `mass` before child colliders
  inherit rigid-body props. Body mass comes from colliders alone. This is currently
  compensated everywhere — each collider sets its own mass, summing to the intended
  total — but `resolveShapeMass`'s documented contract ("every RigidBody/collider mass
  in this app should route through this") is only half true.
- **Trigger:** Latent. Bites when any future collider path omits per-collider mass, at
  which point the body silently falls back to density 1.0.
- **Evidence:** Static/read-only finding, no repro test. Confirmed by reading
  `node_modules/@react-three/rapier/dist/react-three-rapier.esm.js` (lines 204, 234-251,
  499-501, 1146-1153, 1179-1237).
- **Suspected fix:** Documentation, primarily — record that collider mass is the only
  effective lever, and consider removing the misleading `mass` props from `<RigidBody>`
  so the contract is visible in the code.
- **Related:** BUG-002 (reads the collider-derived mass), BUG-017 (mass distribution).

#### BUG-007 — `sortMotorGroups` comparator is not a valid total order

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 3 session (topological sort)
- **Phase:** 3
- **Audit ID:** F-45
- **Files:** `client/src/components/canvas/utils/kinematicsUtils.ts:5-25`; called from
  `client/src/components/canvas/KinematicNode.tsx:104`
- **Description:** The comparator encodes two independent partial relations (pivot
  dependency, subset containment) and returns `0` otherwise, with no guarantee of
  transitivity. `Array.prototype.sort` with an inconsistent comparator produces
  implementation-defined ordering, so a chain of three or more motor groups can compose
  in the wrong parent → child order. It also runs inside `useFrame`, allocating and
  sorting on every frame.
- **Trigger:** Three or more motor groups sharing shapes — i.e. a multi-joint arm.
- **Evidence:** Was static/read-only at audit time. Now `bugAuditRepro.test.ts` →
  `BUG-007` (6 tests) — and uniquely for this phase, these exercise the **real**
  exported function, not a re-implementation: parent-before-child across all six
  input permutations, determinism, no drops/duplicates, and a cyclic-relation case.
- **Suspected fix:** Replace the comparator with an explicit topological sort over the
  pivot/containment dependency graph, computed once per motor-group change rather than
  per frame.
- **Related:** BUG-008 (the other motor-group resolution bug).

#### BUG-008 — Motor pivot silently falls back to the world origin

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 3 session (unresolvable pivot now skips the group)
- **Phase:** 3
- **Audit ID:** F-46
- **Files:** `client/src/components/canvas/KinematicNode.tsx:106-125`
- **Description:** The pivot resolution chain is
  `meshRefs.get(pivotShapeId)` → `shapes.find(...)` → nothing. When both lookups miss,
  `pivot` silently keeps its constructed value of `(0, 0, 0)` — the world origin — so
  the entire motor group rotates about the scene origin instead of failing visibly.
- **Trigger:** A `pivotShapeId` referencing a deleted shape. Nothing currently prunes
  motor groups when a shape is deleted, so this is reachable through ordinary editing.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Skip the motor group entirely when its pivot cannot be resolved,
  and prune dangling `pivotShapeId` references on shape deletion.
- **Related:** BUG-007 (both are motor-group resolution).

---

# B — Voxel Collider Worker & Kinematic Hold

> **Fixed since this audit:** all eight — BUG-007 … BUG-016 range (2026-08-13,
> Phase 4 session). This completes [Phase 4](#phase-4--voxel-worker-cluster).
>
> The three interacting state-machine bugs (BUG-009/010/011) were fixed as one
> rewrite of the request lifecycle, as the audit recommended. The key change:
> **a request now carries the key it was made for**, instead of the reply being
> filed under whatever key happened to be current when it landed — which is what
> made cache poisoning representable at all. BUG-014's shared worker fell out of
> the same rewrite, since multiplexing by request id is what a pool needs anyway.
>
> BUG-016 is the one that did NOT change collider geometry: the bulk/fine overlap
> is deliberate and is what guarantees no gaps, so only the `volume` each box is
> charged for was corrected.

**BUG-009, BUG-010 and BUG-011 are one cluster** — three unhandled states in the same
hook/component pair. They interact, and fixing one in isolation risks masking the
others; scope them as a single fix.

#### BUG-009 — Cache poisoning: a superseded request writes its result under the wrong key

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 4 session (request carries its own key; cache-hit cancels in-flight)
- **Phase:** 4
- **Audit ID:** F-17
- **Files:** `client/src/lib/useVoxelCollider.ts:42-51` (message handler),
  `:77-86` (`compute` early returns)
- **Description:** The cache-hit early return at line 81 does **not** bump `seqRef`, so
  a still-in-flight request for key A remains "current" by id. When A's result lands,
  the handler writes `resultCache.set(lastKeyRef.current /* = B */, A's boxes)` and calls
  `setBoxes(A's boxes)`. Key B is now permanently mapped to the wrong collider set for
  the rest of the session, and the wrong colliders are displayed immediately.
- **Trigger:** Edit a shape so its key goes A → B, where B was already voxelized, while
  A is still computing. Undo/redo is the obvious path.
- **Evidence:** Static/read-only finding, no repro test — the race is in React/worker
  state and was traced by reading the sequence-guard logic, not executed.
- **Suspected fix:** Needs a dedicated planning pass, jointly with BUG-010 and BUG-011.
  Minimally the cache-hit path must invalidate the in-flight sequence, and the handler
  should key the cache write on the request's own key rather than `lastKeyRef`.
- **Related:** BUG-010, BUG-011, BUG-012 (same hook, same state machine).

#### BUG-010 — Worker error leaves the body permanently kinematic

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 4 session (worker error resolves as an empty result)
- **Phase:** 4
- **Audit ID:** F-18
- **Files:** `client/src/lib/useVoxelCollider.ts:43-47`,
  `client/src/components/canvas/VoxelizedShapeBody.tsx:92-108`
- **Description:** On a worker error the handler sets `error`, clears `loading`, and
  returns *before* `setBoxes`, leaving `boxes === null`. `VoxelizedShapeBody` computes
  `resolved = !loading && boxes !== null`, so `resolved` stays false: the body never
  flips to dynamic and never receives the fallback collider. It hangs kinematic in
  mid-air indefinitely — directly contradicting the code's own comment that "a genuine
  failure still gets the fallback collider and should still go dynamic".
- **Trigger:** Any throw inside `buildVoxelCompoundColliders` — a degenerate mesh, or
  out-of-memory on a large grid.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Set `boxes` to `[]` on the error path so the existing
  `failed` branch takes over and the documented fallback actually runs.
- **Related:** BUG-009, BUG-011, BUG-012, BUG-013 (same silent-failure family).

#### BUG-011 — Re-voxelization drops every collider off a live dynamic body

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 4 session (previous colliders held across re-voxelization)
- **Phase:** 4
- **Audit ID:** F-19
- **Files:** `client/src/components/canvas/VoxelizedShapeBody.tsx:92-94` (`ready`),
  `:158-185` (collider render branches)
- **Description:** On *re*-voxelization the body is already dynamic, but `ready` goes
  false while loading and the render falls to the `null` branch — unmounting every
  collider. A dynamic body with zero colliders falls through the floor. The
  kinematic hold only protects the *first* resolve; it is never re-applied.
- **Trigger:** Shape geometry changes while the simulation is running — a live edit, a
  motor-driven scale change, or a GLB finishing its load and mutating `gltfGeometryMap`.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Keep the previous box set mounted until the new one resolves, or
  re-apply the kinematic hold for the duration of any subsequent recompute.
- **Related:** BUG-009, BUG-010 (same cluster), BUG-002 (chassis mass depends on
  collider presence).

#### BUG-012 — `lastKeyRef` is never cleared after an error, so the shape never retries

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 4 session (key cleared on error so a retry is possible)
- **Phase:** 4
- **Audit ID:** F-20
- **Files:** `client/src/lib/useVoxelCollider.ts:77-78`
- **Description:** `lastKeyRef` is set before the request is sent and is never cleared
  on the error path, so `compute()` for that same key no-ops forever afterwards. A
  single transient worker failure becomes permanent for that shape until the component
  remounts.
- **Trigger:** Follows BUG-010 — any worker error at all.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Clear `lastKeyRef` on the error path, the same way the effect
  cleanup already does on teardown.
- **Related:** BUG-010 (its direct cause).

#### BUG-013 — Null `voxelInput` leaves the body permanently kinematic

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 4 session (bounded grace period, then resolve as failed)
- **Phase:** 4
- **Audit ID:** F-21
- **Files:** `client/src/components/canvas/VoxelizedShapeBody.tsx:67-83` (memo),
  `:85-90` (effect), `:97-108` (dynamic flip)
- **Description:** If `voxelInput` is null the effect returns without calling
  `compute`, so `loading` stays false and `boxes` stays null — `resolved` never becomes
  true. Same permanent-kinematic outcome as BUG-010, reached by a different path, and
  with no error surfaced at all.
- **Trigger:** A `glb` shape whose URL is not yet in `gltfGeometryMap` — still loading,
  or the merge failed silently in the empty `catch` at `SimulationScene.tsx:1017`.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Treat a persistently-null `voxelInput` as a resolved failure so
  the fallback collider path runs, rather than waiting forever.
- **Related:** BUG-010 (same outcome), BUG-046 (the empty catch that produces the input
  condition).

#### BUG-014 — One dedicated `Worker` per component instance, with no pool

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 4 session (one shared worker, multiplexed by request id)
- **Phase:** 4
- **Audit ID:** F-22
- **Files:** `client/src/lib/useVoxelCollider.ts:31-68`; consumed by
  `client/src/components/canvas/VoxelCompoundColliders.tsx:49` and
  `client/src/components/canvas/VoxelizedShapeBody.tsx:65`
- **Description:** Every `VoxelCompoundColliders` and `VoxelizedShapeBody` instance
  spawns its own `Worker`. A scene with N voxelized members holds N worker threads, each
  with its own module graph and BVH copies. There is no pooling or reuse.
- **Trigger:** An assembly with many hollow members. `MemberCollider`'s recursive
  expansion multiplies the count further.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Move to a shared module-level worker (or a small pool) with
  request multiplexing by id — the sequence-id machinery this needs already partly
  exists in the hook.
- **Related:** BUG-009 (a shared worker changes the sequencing design, so scope
  together).

#### BUG-015 — CSG group re-copies its entire geometry buffers on every render

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 4 session (solids/holes memoized on members)
- **Phase:** 4
- **Audit ID:** F-23
- **Files:** `client/src/components/canvas/CSGGroup.tsx:65-66` (`solids`/`holes`),
  `:144-162` (`holeFeatureRegions`), `:378-386` (`csgVoxelInput`)
- **Description:** `solids` and `holes` are re-filtered in the component body, so they
  take a new array identity every render. `holeFeatureRegions` depends on `holes`, and
  `csgVoxelInput` depends on that — so the entire CSG mesh's position and index buffers
  are copied into fresh typed arrays on *every single render*. The `anchor` prop, an
  array literal from the parent, makes this unconditional.
- **Trigger:** Every render of any CSG group in the simulation. `compute()` no-ops on
  the unchanged key, so this is pure wasted work rather than wrong output.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Memoize `solids`/`holes` on `members`, and memoize `anchor` at the
  call site in `SimulationScene`.
- **Related:** —

#### BUG-016 — Feature and bulk voxel grids emit overlapping boxes, double-counting volume

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 4 session (bulk box volume excludes the fine grid's coverage)
- **Phase:** 4
- **Audit ID:** F-07
- **Files:** `client/src/lib/voxelCollider.ts:365-372` (region padding),
  `:378-384` (exclusion test), `:389-410` (both grid passes)
- **Description:** Feature grids sample the larger *coverage* region while the bulk grid
  only excludes cells touching the smaller *exclusion* region. The one-bulk-voxel margin
  between the two is sampled twice, so boxes physically overlap and the summed `volume`
  that drives mass fractions double-counts that material. Total mass stays correct
  because fractions renormalize, but the mass *distribution* is biased toward hole rims,
  shifting the centre of mass.
- **Trigger:** Any shape with a declared feature region — i.e. every CSG shape with a
  structural hole.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-07` (1 test): a 2×2×2 block with one
  feature region sums to more than 8 units of volume.
- **Suspected fix:** Either compute mass fractions from a de-overlapped volume, or make
  the exclusion and coverage regions coincide and close the resulting gap another way.
  The padding asymmetry is deliberate (documented in the file), so this needs care.
- **Related:** BUG-017 (mass distribution across collider paths).

---

# C — Collider Mass, Inertia & Shape Fidelity

> **Fixed since this audit:** all seven — BUG-017 … BUG-023 (2026-08-13, Phase 5
> session). This completes [Phase 5](#phase-5--massinertia-consistency).
>
> **BUG-017's decision:** switched to volume-weighted. The even split existed to
> match the old flat `getCompoundColliders` traversal — which Phase 2 deleted as
> dead code (BUG-033). Once the thing it was matching was gone, the only argument
> for keeping physically wrong mass distribution went with it, and every other
> collider path here was already volume-weighted.
>
> The four collider-fidelity fixes all shared one shape: a collider sized off
> nominal constants while the mesh was built by something that added to them
> (an extrude bevel, a chord vs an arc, a dropped axis). The rule that falls out
> is to derive collider dimensions from the same geometry the mesh uses, not from
> the constants that geometry was seeded with.

Four independent implementations of "split this shape's mass across its pieces" disagree
with one another, and one of them is not volume-weighted at all.

#### BUG-017 — `MemberCollider` splits composite mass evenly, not by volume

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 5 session (volume-weighted, replacing the even split)
- **Phase:** 5
- **Audit ID:** F-24
- **Files:** `client/src/components/canvas/MemberCollider.tsx:36-48` (`countLeaves`),
  `:113` (`perLeafMass`)
- **Description:** `perLeafMass = totalLeafMass / countLeaves(...)` is an *equal* split
  per leaf that ignores volume entirely, while `VoxelCompoundColliders`,
  `VoxelizedShapeBody`, the cogwheel decomposer and both Tier 1 decomposers are all
  volume-weighted. A 200 mm base plate and an M3 screw in the same assembly each receive
  half the mass. Total mass is right; centre of mass and inertia tensor are not.
- **Trigger:** Any hole-free `custom` composite whose leaves differ in size — i.e. most
  real assemblies.
- **Evidence:** Static/read-only finding, no repro test. The code comment states this
  deliberately matches the old flat traversal, so it is legacy parity rather than an
  accident — but it is still wrong physics.
- **Suspected fix:** Needs a dedicated planning pass. Switching to volume weighting
  changes documented legacy behaviour, so the decision (and what it breaks) matters more
  than the edit.
- **Related:** BUG-016 (the other mass-distribution issue), BUG-006 (how mass reaches
  Rapier at all).

#### BUG-018 — Torus volume formula has R and r swapped

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 5 session (2*pi^2*R*r^2)
- **Phase:** 5
- **Audit ID:** F-01
- **Files:** `client/src/lib/physicsUtils.ts:38-42`
- **Description:** Returns `2π·R²·π·r` = 2π²R²r; the true torus volume is 2π²R·r². At
  the app's own default torus proportions (R = 0.4, r = 0.15) that is **2.67× too
  heavy** — 0.4737 against a true 0.1777. Cross-checked against the render mesh's
  measured volume: 2.98× too heavy. The ratio of error is exactly R/r, so it worsens as
  the torus gets thinner.
- **Trigger:** Every torus whose mass has not been hand-edited, via
  `resolveShapeMass` → `calculateShapeMass` → here.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-01` (2 tests): divergence from the
  analytic formula, and divergence from the measured render-mesh volume.
- **Suspected fix:** Correct the formula to `2 * Math.PI ** 2 * majorRadius * minorRadius ** 2`.
  Small enough to fix directly; the repro already encodes the expected value.
- **Related:** BUG-022 (the other wrong volume formula in the same switch).

#### BUG-019 — Cylinder and cone colliders drop the Z scale

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 5 session (non-uniform radial scale falls back to a real boundary)
- **Phase:** 5
- **Audit ID:** F-02
- **Files:** `client/src/lib/physicsUtils.ts:383-393`
- **Description:** Both take their radius from `scale[0]` only, discarding `scale[2]`
  entirely. A cylinder scaled `[1, 2, 4]` gets a byte-identical collider to one scaled
  `[1, 2, 1]`. The `sphere` case immediately above already handles exactly this problem
  for non-uniform scale by falling back to a real scaled boundary; cylinder and cone
  were never updated to match.
- **Trigger:** Any non-uniformly scaled cylinder or cone. In the example above the
  collider is 4× narrower than the visible mesh along Z.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-02` (2 tests): identical collider
  args for round vs. oval, for both cylinder and cone.
- **Suspected fix:** Apply the same non-uniform fallback the sphere case uses —
  `buildGeometryColliderConfig` when the radial axes differ beyond a tolerance.
- **Related:** BUG-021 (the other collider/mesh mismatch).

#### BUG-020 — Torus wedge mass fractions can sum to less than 1

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 5 session (share normalized across emitted wedges)
- **Phase:** 5
- **Audit ID:** F-03
- **Files:** `client/src/lib/physicsUtils.ts:300-312`
- **Description:** Wedges are skipped when a bucket holds fewer than 4 points
  (`continue` at line 303), but the survivors still receive a hard-coded
  `1 / wedgeCount`. Mass fractions then sum to less than 1 and the body is quietly
  lighter than authored, with no guard or warning.
- **Trigger:** Not reachable at the default 12 wedges with the current mesh, but nothing
  prevents it — a lower-poly torus, a finer wedge count, or a mesh change makes it live.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-03` (2 tests): the default-count
  baseline sums to 1; driving `wedgeCount` high enough to starve buckets drops it below.
- **Suspected fix:** Normalize fractions across the wedges actually emitted, rather than
  assuming all `wedgeCount` of them survive.
- **Related:** BUG-017 (mass-fraction consistency across paths).

#### BUG-021 — Cogwheel collider does not match its render mesh

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 5 session (bevel included; bore corners circumscribed)
- **Phase:** 5
- **Audit ID:** F-04
- **Files:** `client/src/lib/physicsUtils.ts:199-251`
  (`getCogwheelCompoundColliders`),
  `client/src/components/canvas/utils/geometryHelpers.ts:71-83` (extrude settings)
- **Description:** The collider is built from the `COGWHEEL_*` constants, but the render
  mesh is an `ExtrudeGeometry` with `bevelSize`/`bevelThickness` of `0.015`. Measured:
  the mesh is more than 10% thicker than the collider and its outer radius exceeds
  `COGWHEEL_OUTER_RADIUS`. Separately, each base wedge's inner edge is a straight chord
  between two bore-radius points, so at 6 teeth the collider intrudes to 0.866 × bore —
  a shaft sized to the bore fits the rendered mesh but not the collider.
- **Trigger:** Any dynamic cogwheel; worst on the 6-tooth variant. Gears mesh and stack
  slightly wrong.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-04` (3 tests): mass fractions sum
  correctly (baseline), chord intrusion into the bore, and collider thinner/narrower
  than the measured render mesh.
- **Suspected fix:** Include the bevel in the collider's depth and outer radius, and
  place the inner corners on a circumscribed rather than inscribed radius so the bore
  stays at least its nominal size.
- **Related:** BUG-019 (collider/mesh mismatch), BUG-022 (same shape's volume).

#### BUG-022 — Cogwheel volume is computed as a solid cylinder

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 5 session (summed wedge volumes, not a solid cylinder)
- **Phase:** 5
- **Audit ID:** F-27
- **Files:** `client/src/lib/physicsUtils.ts:44-51`
- **Description:** Volume is `π·r²·h`, ignoring both the axle bore and the roughly 20%
  of each angular step that is tooth gap. This over-estimates default mass by about a
  third. The exact per-wedge volumes needed to compute this correctly are already
  calculated 150 lines further down in `getCogwheelCompoundColliders`.
- **Trigger:** Every cogwheel without a hand-set mass.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Sum the wedge volumes `getCogwheelCompoundColliders` already
  computes, instead of the cylinder approximation.
- **Related:** BUG-018 (the other wrong volume formula), BUG-021 (same shape).

#### BUG-023 — Static CSG `TrimeshCollider` ignores authored friction and restitution

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — Phase 5 session (friction/restitution passed through)
- **Phase:** 5
- **Audit ID:** F-16
- **Files:** `client/src/components/canvas/CSGGroup.tsx:576-582`
- **Description:** This is the only collider in the file that receives no `friction` or
  `restitution` prop, so it silently uses Rapier's defaults instead of the group's
  authored values. Every sibling collider in the same component passes them through.
- **Trigger:** A locked (fixed) CSG boolean group in the simulation.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Pass `friction` and `restitution` through, matching the sibling
  `VoxelCompoundColliders` branch immediately below it.
- **Related:** —

---

# D — Bore Decomposers (Tier 1a / 1b)

> **Fixed since this audit:** all five — BUG-024 … BUG-028 (2026-08-13, Phase 7).
>
> **BUG-027 was dissolved rather than decided.** The plan framed it as a choice
> between patching `THREE` prototypes on the main thread and moving the module into
> a worker. Neither was needed: `three-mesh-bvh` exports `MeshBVH` with a
> `raycastFirst` method, so the module now calls the BVH API directly and has no
> global side effect at all. That also removed the gate the other four sat behind.

Both modules are **not wired into any live collider path** — they are imported by tests
only, and both files document this status themselves. No finding here has current user
impact; they are recorded so the wiring pass starts from a known state.

#### BUG-024 — Tier 1a and Tier 1b disagree on which body defines the extrusion frame

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (Tier 1b extrudes over the solid's extent, matching Tier 1a)
- **Phase:** 7
- **Audit ID:** F-25
- **Files:** `client/src/lib/boundaryFollowingBoreDecomposition.ts:306`, `:411-412`,
  `:433`; `client/src/lib/concentricBoreDecomposition.ts:396-403`
- **Description:** Tier 1a extrudes wedges at the *solid's* height and centre; Tier 1b
  extrudes at the *hole's*. Hole cutters are conventionally oversized — `CSGGroup` even
  scales them by 1.01 — and the through-hole check only rejects holes that are too
  *short*, never too long. So Tier 1b's collider runs past the real material at both
  ends, and its Simpson volume over-counts to match.
- **Trigger:** Any Tier 1b decomposition where the hole is longer than the solid. No
  user impact today since neither module is wired in.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Clamp Tier 1b's extrusion to the solid's measured extent along the
  bore axis, matching Tier 1a.
- **Related:** BUG-025 (the other missing axial check).

#### BUG-025 — `decomposeConcentricBore` accepts an axially displaced hole

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (hole must actually span the solid, not just match its height)
- **Phase:** 7
- **Audit ID:** F-05
- **Files:** `client/src/lib/concentricBoreDecomposition.ts:378-403`
- **Description:** Nothing compares the hole's centre *along the bore axis* to the
  solid's — only radial offset and height are checked. A hole of the right length slid
  almost entirely off the end is accepted and decomposed into a clean centred
  through-bore. The function's contract promises "null, never a partial or best-effort
  result" for anything outside the recognized pattern; this slips through.
- **Trigger:** An off-end hole in a Tier 1a candidate shape.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-05` (1 test): a hole at
  `center[1] = 1.9` in a 2-unit solid produces byte-identical geometry and volume to a
  properly centred one.
- **Suspected fix:** Add an axial-centre tolerance check alongside the existing radial
  concentricity check.
- **Related:** BUG-024 (both concern axial alignment).

#### BUG-026 — BVH is disposed before the refinement loop, silently falling back to brute force

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (BVH held for the whole pass; geometry released in finally)
- **Phase:** 7
- **Audit ID:** F-26
- **Files:** `client/src/lib/boundaryFollowingBoreDecomposition.ts:444` (dispose),
  `:451-467` (refinement loop), `:427-473` (geometry lifetime)
- **Description:** `disposeBoundsTree()` is called *before* the adaptive-refinement
  loop. It sets `boundsTree = null`, and `acceleratedMeshRaycast` then silently falls
  back to three.js's brute-force `origMeshRaycastFunc` — so every refinement raycast runs
  un-accelerated. This is the exact 3.2 s → 70 ms cliff that `voxelCollider.ts`
  documents, and it means the module's own measured 138 ms budget figure was taken with
  the BVH already gone. Separately, `raycastGeom` is never disposed on any exit path.
- **Trigger:** Every Tier 1b call that subdivides at all.
- **Evidence:** Static/read-only finding, no repro test. Confirmed by reading
  `node_modules/three-mesh-bvh/src/utils/ExtensionUtilities.js` — `disposeBoundsTree`
  nulls the tree and `acceleratedMeshRaycast` falls through to the original raycast.
- **Suspected fix:** Move the dispose after the refinement loop, and dispose
  `raycastGeom` on every exit path. Re-measure the budget afterwards, since the
  published timings are invalid.
- **Related:** BUG-027 (the other BVH/prototype concern in this module).

#### BUG-027 — Module patches global `THREE` prototypes on whatever thread imports it

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (uses MeshBVH directly; no global prototype patch at all)
- **Phase:** 7
- **Audit ID:** F-51 (originally filed under TODO/FIXME markers)
- **Files:** `client/src/lib/boundaryFollowingBoreDecomposition.ts:30-41`
- **Description:** The file carries an explicit `FUTURE WIRING NOTE`: the
  `THREE.BufferGeometry` / `THREE.Mesh.prototype` BVH patches run at module load on
  whatever thread imports the module, unlike `voxelCollider.ts` which is worker-only and
  documents itself as safe on that basis. The comment explicitly asks that this not be
  carried forward silently. This is a live unresolved decision, not a stale note.
- **Trigger:** Currently harmless because nothing imports the module outside tests. But
  `THREE.Mesh.prototype.raycast` is global, so wiring Tier 1b in as-is changes raycast
  behaviour for every mesh in the app — including React Three Fiber's pointer picking.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Needs a dedicated planning pass as part of the Tier 1b wiring work
  — either move the module into a worker, or explicitly accept and document main-thread
  prototype patching.
- **Related:** BUG-026 (same module's BVH handling).

#### BUG-028 — Unreachable piece-count ceiling check

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — Phase 7 session (unreachable branch removed)
- **Phase:** 7
- **Audit ID:** F-48
- **Files:** `client/src/lib/boundaryFollowingBoreDecomposition.ts:281` (entry guard),
  `:309` (post-push check)
- **Description:** The post-push check
  `if (outPieces.length > config.maxTotalPieces) return false;` is unreachable: the
  entry guard at line 281 already returns when `length >= max`, so after one push the
  length can be at most `max`. This is a dead branch, not an off-by-one — the effective
  cap is exactly `maxTotalPieces`, as intended.
- **Trigger:** Never.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Delete the dead branch.
- **Related:** —

---

# E — CSG Member-Tree Traversal & Cycle Safety

> **Fixed since this audit:** BUG-029, BUG-030, BUG-031, BUG-032 (guarded),
> BUG-033, BUG-034 (deleted) — all 2026-08-13, Phase 2 session. This completes
> [Phase 2](#phase-2--cycle-guard-sweep-one-coordinated-fix); the section is now clear.
>
> **The guard that was added**, in every walker, following
> `GrabbingSystem.ts:394-413`: a `seen`/`path` set keyed on **object identity**
> (`CustomMember` has no id field, and a cycle requires identity sharing anyway),
> scoped to the **current path** rather than the whole traversal. Path-scoping is
> deliberate — a member tree may legitimately be a DAG, with one authored part
> reused as two siblings, and a global visited-set would silently truncate the
> second occurrence and drop real geometry. Only a genuine ancestor cycle fires.
>
> `CompositeMemberColliders` additionally caps at `MAX_COMPOSITE_DEPTH = 32`,
> because it recurses as *React components* — an immutable ancestor set is passed
> per child, since add-before/delete-after does not survive React rendering
> children after the parent returns.
>
> Verified in `bugAuditRepro.test.ts` (26 tests, +11): self-reference, A→B→A
> mutual cycles, a real hole on a cyclic branch, cache-key stability, the DAG
> negative case, the 500-level acyclic negative case, and a `control` test proving
> the unguarded `getRootGroupId` walk never terminates. Separately verified that
> `serializeMembers` produces **byte-identical keys to the old implementation for
> every acyclic tree**, so no saved workspace's voxel cache key shifted.

Six independent walkers recurse through `customMembers` (or the group tree) and **none
carries a visited-set or a depth cap**. Deep acyclic trees are fine — verified at 500
levels — so the exposure is specifically cycles. Nothing in the audit proves the editor
can currently author one; equally, nothing anywhere *rejects* one, and persisted or
hand-edited JSON reaches these walkers directly on load.

`client/src/components/canvas/utils/GrabbingSystem.ts:394-413` is the one walker in the
codebase that guards correctly, with a `seen` set. It should be the template for all
fixes in this section.

#### BUG-029 — Voxelization member walkers recurse without a cycle guard

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 2 session (path-scoped cycle guard)
- **Phase:** 2
- **Audit ID:** F-06
- **Files:** `client/src/lib/hollowShapeVoxelization.ts:17-22` (`hasStructuralHoles`),
  `:54-71` (`collectHoleRegions`), `:73-81` (`serializeMembers`)
- **Description:** All three recurse into `m.customMembers` with no visited-set and no
  depth cap. Confirmed: `hasStructuralHoles` throws
  `RangeError: Maximum call stack size exceeded` on a self-referential member. These sit
  on the render *and* collider paths, so the throw is not catchable at any useful
  boundary.
- **Trigger:** Any cyclic `customMembers` structure reaching these functions — most
  plausibly via loaded or hand-edited persisted state.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-06 / BUG-029` (8 tests, flipped
  2026-08-13 from asserting the throw to asserting the guard): self-reference,
  A→B→A mutual cycle, a real hole found on a cyclic branch, cache-key stability and
  distinctness, plus two negative controls — a 500-level acyclic tree and a DAG,
  neither of which may be mistaken for a cycle.
- **Suspected fix:** Add a shared `seen`-set guard following the `GrabbingSystem`
  pattern, applied across all walkers in this section together.
- **Related:** BUG-030, BUG-031, BUG-032, BUG-033 (all missing the same guard).

#### BUG-030 — `JSON.stringify` memo key throws on a cyclic member tree

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 2 session (memo key now serializeMembers)
- **Phase:** 2
- **Audit ID:** F-28
- **Files:** `client/src/components/canvas/MemberCollider.tsx:227`,
  `client/src/components/canvas/VoxelizedShapeBody.tsx:81`
- **Description:** Both components key their voxel-input `useMemo` on
  `JSON.stringify(shape.customMembers)`, which throws
  `TypeError: Converting circular structure to JSON` — during render, in a component
  with no error boundary above it. Secondary issue: this stringify runs on every render
  of every member, over the full member tree.
- **Trigger:** Same as BUG-029 — any cyclic `customMembers`.
- **Evidence:** repro `bugAuditRepro.test.ts` → `F-06 / BUG-029`, "the memo key no
  longer routes through JSON.stringify". Additionally verified out-of-band that
  `serializeMembers` returns byte-identical keys to the old implementation for every
  acyclic tree, so no existing voxel cache entry was invalidated.
- **Suspected fix:** Reuse the cycle-safe `serializeMembers` (once BUG-029 is fixed)
  as the memo key instead of `JSON.stringify`, which also removes the per-render cost.
- **Related:** BUG-029 (same root cause), BUG-041 (no boundary to catch the throw).

#### BUG-031 — Collider and geometry member walkers recurse without a cycle guard

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 2 session (cycle guard + MAX_COMPOSITE_DEPTH cap)
- **Phase:** 2
- **Audit ID:** F-29
- **Files:** `client/src/components/canvas/MemberCollider.tsx:36-48` (`countLeaves`),
  `:129-145` (`CompositeMemberColliders`),
  `client/src/components/canvas/utils/geometryHelpers.ts:133-158`
  (`evaluateCustomGeometry`)
- **Description:** `countLeaves` and `CompositeMemberColliders` recurse without a
  guard — the latter as unbounded *React* recursion, which blows the render stack rather
  than a plain call stack. `evaluateCustomGeometry` has the same gap and additionally
  runs a full CSG evaluation at every level, so a cycle is expensive well before it
  overflows.
- **Trigger:** Same as BUG-029.
- **Evidence:** Was static/read-only at audit time. Now `bugAuditRepro.test.ts` →
  `BUG-031` (2 tests) covers `evaluateCustomGeometry` directly — the walker on the
  render path — asserting it substitutes a placeholder rather than recursing, and
  leaves an ordinary nested composite untouched.
- **Suspected fix:** Same shared `seen`-set guard as BUG-029; for the React recursion,
  also cap depth so a malformed tree degrades rather than crashes.
- **Related:** BUG-029, BUG-030 (same root cause), BUG-037 (same function, disposal).

#### BUG-032 — `getRootGroupId` walks the group tree in an unguarded `while (true)`

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 2 session (seen-set guard)
- **Phase:** 2
- **Audit ID:** F-12 (originally filed under the vehicle pass)
- **Files:** `client/src/components/canvas/SimulationScene.tsx:698-712`
- **Description:** Walks `parentGroupId` in a `while (true)` with no visited-set. A
  cycle in `groups` hangs the tab — not a stack overflow but an unrecoverable freeze,
  which is a worse failure mode than the other findings in this section.
- **Trigger:** A cyclic `parentGroupId` from hand-edited or corrupted saved state.
- **Evidence:** Was static/read-only at audit time. Now `bugAuditRepro.test.ts` →
  `BUG-032` (4 tests), including a **control** proving the unguarded walk never
  terminates, and one asserting members of the same cyclic group still resolve to a
  common root so `getBodyRef`/`groupMapping` keep grouping correctly.
- **Suspected fix:** Add the same `seen`-set guard used in
  `GrabbingSystem.ts:394-413`, breaking out on revisit.
- **Related:** BUG-029, BUG-031 (fix with the same pattern), BUG-001 (this function
  feeds `getBodyRef`).

#### BUG-033 — Dead compound-collider builders, also unguarded

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — deleted dead code (both functions removed, not guarded)
- **Phase:** 2
- **Audit ID:** F-30
- **Files:** `client/src/lib/physicsUtils.ts:448-514` (`getCompoundColliders`),
  `:520-559` (`getCSGGroupCompoundColliders`), `:466-469` (unreachable branch)
- **Description:** Both functions have **zero call sites** — verified; they appear only
  in comments describing what replaced them. `getCompoundColliders` recurses through
  `customMembers` unguarded, like the rest of this section. If revived, note that
  `getCSGGroupCompoundColliders` calls `getColliderConfig` directly, bypassing the
  cogwheel/torus decomposition that `getShapeColliderConfigs`' own doc comment says every
  call site must use, and assigns no `massFraction` at all. Line 467's
  `m.isHole ? scale[1] + 0.05 : …` is unreachable — holes already returned at line 460.
- **Trigger:** Dead code today.
- **Evidence:** Static/read-only finding, no repro test. Call-site absence verified by
  grep across `src`.
- **Suspected fix:** Delete both functions, or fix the guard and the decomposition
  bypass if there is a plan to revive them.
- **Related:** BUG-034 (same function), BUG-029 (same missing guard), BUG-051 (dead
  code inventory).

#### BUG-034 — `getCSGGroupCompoundColliders` may derive its frame from a hole member

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — moot: resolved by BUG-033's deletion of the containing function
- **Phase:** 2
- **Audit ID:** F-49
- **Files:** `client/src/lib/physicsUtils.ts:528`, `:558`
- **Description:** Takes `members[0]` as the parent frame without checking `isHole`, so
  the whole local frame can be derived from a hole member that the loop below then skips.
  The fallback at line 558 returns that hole's own collider.
- **Trigger:** Dead code — see BUG-033.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Select the first non-hole member as the frame, if this function is
  revived rather than deleted.
- **Related:** BUG-033 (same function, same disposition decision).

---

# F — GLB Loading, Disposal & GPU Memory

> **Fixed since this audit:** all six — BUG-035 … BUG-040 (2026-08-13, Phase 6
> session). This completes [Phase 6](#phase-6--glb-loading--disposal).
>
> The ownership rule that came out of it: **this app clones GLB materials but never
> GLB geometry**, because `Object3D.clone()` shares geometry by reference. So a
> component may dispose the materials it cloned and must never dispose geometry
> reached through `useGLTF`. BUG-035 was that rule being violated; BUG-036/037 were
> the opposite — geometry this app really does own, never released.

The audit brief noted one documented instance of the missing-disposal pattern. There are
five more here — and one that is the opposite problem: a *premature* dispose of shared
state.

#### BUG-035 — `GlbShapeMesh` disposes geometry it does not own

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 6 session (disposes only the cloned materials, never shared geometry)
- **Phase:** 6
- **Audit ID:** F-38
- **Files:** `client/src/components/canvas/GlbShapeMesh.tsx:22-23` (`scene.clone(true)`),
  `:29` (material clone), `:102-118` (`disposeWrapper`)
- **Description:** `scene.clone(true)` deep-copies the node graph, but three.js's
  `Mesh.copy` *shares* the geometry reference. The memo explicitly clones
  `mesh.material` but not the geometry — then `disposeWrapper` calls
  `mesh.geometry.dispose()` on drei's cached, shared GLTF geometry. Unmounting one
  instance destroys the GPU buffers every other instance of that URL is still drawing
  from, and every future instance too, since `useGLTF` keeps returning the same cached
  scene.
- **Trigger:** Place two shapes from the same `.glb`, then delete one. The survivors
  break.
- **Evidence:** Static/read-only finding, no repro test. Sharing semantics confirmed
  against three.js `Mesh.copy`.
- **Suspected fix:** Dispose only the cloned materials, not the shared geometry — or
  clone the geometry too if per-instance ownership is actually wanted. Small, targeted
  fix.
- **Related:** BUG-038, BUG-039 (same disposal machinery).

#### BUG-036 — `CustomShapeMesh` never disposes its CSG result geometry

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 6 session (cleanup effect disposes the previous CSG result)
- **Phase:** 6
- **Audit ID:** F-39
- **Files:** `client/src/components/canvas/CustomShapeMesh.tsx:39-71`
- **Description:** The `resultMesh` `useMemo` builds a fresh `BufferGeometry` on every
  dependency change and has **no cleanup effect** — the previous geometry is simply
  dropped. `CSGGroup.tsx:388-392` does exactly this correctly for its own result;
  `CustomShapeMesh` was never given the same treatment. Note the degenerate branch at
  line 59 *does* dispose, so the omission is only on the success path.
- **Trigger:** Every edit to any CSG custom shape — move, scale, recolour, undo.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Add the same cleanup effect `CSGGroup` already uses, disposing the
  previous geometry on change and unmount.
- **Related:** BUG-037 (the leak inside the function it calls), BUG-035, BUG-038.

#### BUG-037 — `evaluateCustomGeometry` never disposes CSG intermediates

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 6 session (staleGeometries set, ported from CSGGroup)
- **Phase:** 6
- **Audit ID:** F-40
- **Files:** `client/src/components/canvas/utils/geometryHelpers.ts:178-212`
- **Description:** Every intermediate from the `ADDITION` fold, every intermediate from
  the `SUBTRACTION` loop (including the retry's discarded first attempt), and the
  pre-crease geometry replaced by `toCreasedNormals` all leak. `CSGGroup` solves
  precisely this with its `staleGeometries` set; this function — called from the render
  path, the voxelization path *and* Tier 1b — has no equivalent.
- **Trigger:** Every CSG re-evaluation. The leak scales with member count, so complex
  assemblies leak fastest.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Port `CSGGroup`'s `staleGeometries` set into this function, so
  every caller inherits the fix.
- **Related:** BUG-036 (its main caller), BUG-031 (same function, recursion).

#### BUG-038 — Disposer effect captures a stale wrapper

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 6 session (disposer effect now depends on wrapper)
- **Phase:** 6
- **Audit ID:** F-41
- **Files:** `client/src/components/canvas/GlbShapeMesh.tsx:102-118`
- **Description:** The disposer effect has an empty dependency array with an explicit
  `eslint-disable`, so it closes over the *first* `wrapper`. When `scene` changes the
  memo produces a new wrapper whose cloned materials are never registered for disposal.
- **Trigger:** Changing a shape's `url` in place.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Depend on `wrapper` so each wrapper registers and disposes its own
  resources. Fix together with BUG-035, which is in the same effect.
- **Related:** BUG-035 (same effect), BUG-039 (the registry it writes to).

#### BUG-039 — GPU cleanup registry is keyed on `shape.id` alone

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 6 session (registry holds a Set per shape id)
- **Phase:** 6
- **Audit ID:** F-42
- **Files:** `client/src/lib/useGPUCleanup.ts:5-9`
- **Description:** `disposers` is a module-level `Map` keyed on `shape.id` alone. Two
  components rendering the same shape id — editor and simulation, or a gripper's nested
  `KinematicNode` — silently overwrite each other's disposer, so one wrapper is never
  cleaned up.
- **Trigger:** The same shape mounted in two trees simultaneously.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Key on a per-instance token rather than `shape.id`, or store a list
  of disposers per id.
- **Related:** BUG-035, BUG-038 (its callers).

#### BUG-040 — Thumbnail renderer mutates its input and never releases GPU memory

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 6 session (wrapper-translated centring + URL-keyed cache)
- **Phase:** 6
- **Audit ID:** F-43
- **Files:** `client/src/lib/glbThumbnailRenderer.ts:17-33` (renderer singleton),
  `:45-57` (render + mutation)
- **Description:** Two issues in one function. First, `object.position.sub(center)`
  mutates the caller's object rather than the wrapper — harmless for the current caller,
  which passes a throwaway clone, but it is a trap the signature does not advertise.
  Second, the module holds a second `WebGLRenderer` for the process lifetime with no
  `dispose`; each thumbnailed mesh uploads its own copy of every buffer into *that*
  context, and removing the wrapper from the scene does not release them. The file's own
  header explains it exists to avoid exhausting WebGL contexts — it manages contexts but
  not the memory inside the one it keeps.
- **Trigger:** Scrolling the model library. Grows with the number of distinct models
  previewed.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Translate the wrapper rather than the input object, and dispose the
  uploaded resources after each snapshot (or cache thumbnails by URL so each model is
  rendered once).
- **Related:** —

---

# G — Error Handling & Crash Chains

> **Fixed since this audit:** BUG-041, BUG-042, BUG-043, BUG-044, BUG-045, BUG-046
> (all fixed 2026-08-13 — Phase 1 session). This completes
> [Phase 1](#phase-1--safety-net-crash-containment); the section is now clear.
>
> Verification for BUG-041/BUG-042 is `client/tests/ErrorBoundary.test.tsx`
> (9 tests, jsdom). It includes a **control test** that renders an unguarded throw and
> asserts it escapes and empties the container — so the boundary tests are falsifiable
> rather than vacuously green. `jsdom` was added as a devDependency to enable it; it is
> vitest's own supported DOM option and only that one test file opts into it, via a
> `// @vitest-environment jsdom` docblock.

**BUG-041, BUG-042 and BUG-043 compose into a single reproducible whole-app crash:**
`uploadModel` writes a model record pointing at a file it never creates → dropping that
model makes `useGLTF` throw → the throw unwinds past `<Suspense>`, which does not catch
errors → `App.tsx` has no error boundary → the page goes blank.

#### BUG-041 — No error boundary anywhere in the route tree

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 1 session (shared ErrorBoundary wrapping both routes)
- **Phase:** 1
- **Audit ID:** F-31
- **Files:** `client/src/App.tsx:6-17`
- **Description:** There is no error boundary in the route tree at all.
  `AddObjectsSection.tsx:13` defines a perfectly serviceable `ErrorBoundary` class, but
  it is used only around thumbnail previews — never around the routes or the 3D canvases.
- **Trigger:** Any render-phase throw in `CadStudio` or `SimulationStudio` blanks the
  entire app with no recovery path. Reachable via BUG-030, BUG-042 and BUG-044 among
  others.
- **Evidence:** Was static/read-only at audit time. Now covered by
  `client/tests/ErrorBoundary.test.tsx` (5 tests under "BUG-041 route
  containment", plus the shared control test proving an unguarded throw escapes).
- **Suspected fix:** Wrap both routes (and the 3D canvases) in an error boundary,
  reusing the existing `ErrorBoundary` class or a shared extraction of it.
- **Related:** BUG-042, BUG-043, BUG-044 (the crash chain), BUG-030 (another throw this
  would contain).

#### BUG-042 — `<Suspense>` does not catch load errors

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 1 session (boundary around each in-Canvas Suspense + DOM notice)
- **Phase:** 1
- **Audit ID:** F-32
- **Files:** `client/src/components/Canvas3D.tsx:562`,
  `client/src/pages/SimulationStudio.tsx:657`
- **Description:** `<Suspense fallback={null}>` wraps the GLTF-loading subtree, but
  Suspense handles *pending*, not *rejected*. A 404 or malformed GLB propagates straight
  through to BUG-041.
- **Trigger:** A missing or corrupt `.glb`. Guaranteed to occur via BUG-043.
- **Evidence:** Was static/read-only at audit time. Now covered by
  `client/tests/ErrorBoundary.test.tsx` (3 tests under "BUG-042 in-Canvas
  asset failures", including one asserting the fallback emits no DOM — a `<div>`
  inside `<Canvas>` would crash the renderer the boundary is protecting).
- **Suspected fix:** Pair each `<Suspense>` with an error boundary that renders a
  placeholder for the failed asset instead of unmounting the scene.
- **Related:** BUG-041, BUG-043 (same chain).

#### BUG-043 — `uploadModel` fabricates a file path that will always 404

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 1 session (uploads now stored as a data URL, not a fake server path)
- **Phase:** 1
- **Audit ID:** F-33
- **Files:** `client/src/features/models/modelService.ts:74-94`
- **Description:** `uploadModel` synthesises `filePath: `/uploads/${file.name}`` and
  persists it to localStorage without writing any file and without `encodeURIComponent`.
  Every uploaded model is a guaranteed 404, and any name containing a space or `#` is
  additionally a malformed URL. There is no backend in this repo, so nothing ever
  materialises the file.
- **Trigger:** Use the upload button, then place the model.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Store the uploaded file as a blob/data URL in local storage (or
  IndexedDB) and reference that, rather than a server path that does not exist. At
  minimum, URL-encode the name.
- **Related:** BUG-041, BUG-042 (this is the chain's entry point).

#### BUG-044 — Unguarded `JSON.parse` of `cad-studio-paths` crashes the simulation page

- **Severity:** Critical
- **Status:** Fixed 2026-08-13 — Phase 1 session (shared readStoredJson guard for all four initialisers)
- **Phase:** 1
- **Audit ID:** F-34
- **Files:** `client/src/pages/SimulationStudio.tsx:62-66`
- **Description:** The three `useState` initialisers immediately above this one wrap
  their `JSON.parse` in `try/catch`. This one does not: `raw ? JSON.parse(raw) : []`. A
  corrupt `cad-studio-paths` entry throws inside a state initialiser → BUG-041 → blank
  page, unrecoverable without clearing site data. The inconsistency with its three
  neighbours is what makes this an oversight rather than a choice.
- **Trigger:** Corrupt or truncated localStorage.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Add the same `try/catch` its three neighbours already have.
- **Related:** BUG-041 (what turns the throw into a blank page), BUG-045 (the other
  unguarded parse).

#### BUG-045 — SSE frame handler parses JSON without a guard

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 1 session (malformed SSE frames dropped with a counted warning)
- **Phase:** 1
- **Audit ID:** F-35
- **Files:** `client/src/pages/SimulationStudio.tsx:85-88`
- **Description:** The `simulation-frame` listener calls `JSON.parse(event.data)` with
  no `try/catch`. One malformed frame from the circuit stream throws inside the event
  handler.
- **Trigger:** A truncated or non-JSON SSE payload from the external simulation server.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Wrap in `try/catch` and drop malformed frames, ideally with a
  counter surfaced in the circuit readout.
- **Related:** BUG-044 (same file, same class of issue).

#### BUG-046 — Seven empty `catch` blocks swallow diagnostics

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — Phase 1 session (all seven catches now log with context)
- **Phase:** 1
- **Audit ID:** F-37
- **Files:** `client/src/components/Canvas3D.tsx:494`, `:528`;
  `client/src/components/canvas/SimulationScene.tsx:1017`;
  `client/src/types/workspace.ts:39`;
  `client/src/pages/SimulationStudio.tsx:33`, `:45`, `:57`
- **Description:** Seven `catch {}` blocks with no handling. The two GLB-merge ones
  (`Canvas3D:494`, `SimulationScene:1017`) are the consequential pair: a failed
  `mergeBufferGeometries` leaves the URL absent from `gltfGeometryMap` with no
  diagnostic, which is precisely the input condition for BUG-013.
- **Trigger:** Malformed GLB, or quota-exceeded localStorage.
- **Evidence:** Static/read-only finding, no repro test. Surfaced by ESLint `no-empty`
  (7 occurrences).
- **Suspected fix:** Log at minimum; for the GLB-merge pair, record the failure so
  downstream code can distinguish "still loading" from "failed".
- **Related:** BUG-013 (consumes the silent failure).

---

# H — React Render Correctness & Stale State

> **Fixed since this audit:** all four — BUG-047, BUG-048, BUG-049, BUG-050
> (2026-08-13, Phase 7). BUG-047 alone accounted for 13 of the codebase's 20
> `react-hooks/refs` errors; the rule is now down to 7.

#### BUG-047 — Refs are read during render to position a grabbed shape

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (grabbed state read from shape.grabbedBy, not a ref)
- **Phase:** 7
- **Audit ID:** F-14
- **Files:** `client/src/components/canvas/KinematicNode.tsx:410-423`
- **Description:** `outerGroupRef.current.position` and `.rotation` are read *during
  render* to compute `groupPos` and `groupRot` for a grabbed shape. Refs hold the
  previous commit's value and do not trigger a re-render when they change, so a grabbed
  shape renders one frame behind its own transform.
- **Trigger:** A gripper picks up a shape, taking the `isGrabbed` path.
- **Evidence:** Static/read-only finding, no repro test. Surfaced by ESLint
  `react-hooks/refs` — 13 of the rule's 20 codebase-wide errors point at this block.
- **Suspected fix:** Drive the grabbed transform from state or from the grab system's
  own data rather than reading a ref during render.
- **Related:** BUG-049 (same component's memo correctness).

#### BUG-048 — Keyboard nudge closes over stale workspace settings

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (wsSettings added to the dependency array)
- **Phase:** 7
- **Audit ID:** F-44
- **Files:** `client/src/pages/CadStudio.tsx:1709` (dependency array),
  `:1712-1719` (`nudge` and its clamp bounds)
- **Description:** The global keydown effect's dependency array omits `wsSettings`, yet
  the `nudge` closure it captures reads `wsSettings.presetWidth` / `presetLength` to
  clamp movement to the workspace. Changing the workspace size leaves arrow-key nudge
  clamping to the old bounds until an unrelated dependency happens to change.
  `deleteSelectedShapes`, `duplicateShape`, `groupShapes` and `ungroupShapes` are
  captured the same way.
- **Trigger:** Resize the workspace, then nudge a shape with the arrow keys.
- **Evidence:** Static/read-only finding, no repro test. Surfaced by ESLint
  `react-hooks/exhaustive-deps` at `CadStudio.tsx:1709`.
- **Suspected fix:** Move the handler body into a ref that is kept current, or add the
  missing dependencies and stabilise the callbacks with `useCallback`.
- **Related:** —

#### BUG-049 — `areKinematicNodePropsEqual` omits eight compared fields

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — Phase 7 session (comparator covers the eight omitted fields)
- **Phase:** 7
- **Audit ID:** F-47
- **Files:** `client/src/components/canvas/KinematicNode.tsx:460-489`
- **Description:** The comparator checks 16 named shape fields and omits
  `customMembers`, `jointRotation`, `motionInverted`, `isGripper`, `gripOffset`,
  `grabbedBy`, `baseSize` and `mass`. It is saved only by the `a.shapes !== b.shapes`
  identity check, which fires on essentially every state update — meaning the memo is
  simultaneously incorrect *and* doing almost nothing.
- **Trigger:** Any path that mutates an omitted field without replacing the `shapes`
  array.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Either complete the field list or drop the custom comparator, since
  the `shapes` identity check already defeats most of its benefit.
- **Related:** BUG-047 (same component).

#### BUG-050 — `useCSGWorker` has no sequence check, so stale results win

- **Severity:** Moderate
- **Status:** Fixed 2026-08-13 — deleted dead code (useCSGWorker.ts + workers/csgWorker.ts removed)
- **Phase:** 7
- **Audit ID:** F-36
- **Files:** `client/src/lib/useCSGWorker.ts:18` (`pendingRef`), `:27-47` (handler),
  `:57-88` (`compute`)
- **Description:** Unlike `useVoxelCollider`, the message handler never compares `id` to
  `seqRef.current`, so a stale CSG result overwrites a newer one. `pendingRef` is
  populated on every `compute` and never read — the sequence-tracking machinery exists
  but is not wired up. Previous geometries are never disposed, and buffers are copied
  rather than transferred.
- **Trigger:** **Dead code — verified zero call sites** for both `useCSGWorker` and
  `workers/csgWorker.ts`. Severity reflects that; it would be Critical if wired in as-is.
- **Evidence:** Static/read-only finding, no repro test. Call-site absence verified by
  grep across `src`.
- **Suspected fix:** Delete both files, or wire the sequence check and disposal before
  any revival. Note `AGENTS.md` still documents this as the live CSG path.
- **Related:** BUG-009 (the same race, correctly handled elsewhere), BUG-051, BUG-053
  (dead code and stale docs).

---

# I — Dead Code & Documentation Debt

> **Fixed since this audit:** BUG-052, BUG-053 (2026-08-13, Phase 7).
>
> **BUG-051 is deliberately left open.** It is 67 non-null assertions — a
> lint-policy decision (enable `no-non-null-assertion` or not), not a defect with a
> fix. Bulk-rewriting them would be churn; the cited sites are all currently sound.

Dead-code inventory totals roughly **1,420 lines** across four clusters:

| Lines | Code | Note |
|---:|---|---|
| ~880 | `concentricBoreDecomposition.ts` + `boundaryFollowingBoreDecomposition.ts` | Imported by tests only; both files document this status. See §D. |
| ~190 | `useCSGWorker.ts` + `workers/csgWorker.ts` | No call sites. See BUG-050. |
| ~~180~~ | ~~`physicsUtils.ts` `getCompoundColliders` / `getCSGGroupCompoundColliders`~~ | **Removed 2026-08-13** (BUG-033). `physicsUtils.ts` 561 → 450 lines. |
| ~170 | `kinematicsUtils.ts` `getJointWorldTransform` / `getJointGroupWorldMatrix` | No call sites. Their unguarded mutual recursion over `jointParentId` would be a BUG-029-class cycle hazard, but is currently unreachable. |

Plus the 69 `no-unused-vars` sites from the lint baseline, several of which are whole
handlers in `CadStudio.tsx` (`clearCanvas`, `updateSelectedGroupParent`,
`updateTexture`, `setGridSize`, `setScaleFromSide`).

#### BUG-051 — 67 non-null assertions on lookups that are not statically guaranteed

- **Severity:** Minor
- **Status:** Open — deliberately deferred (needs a lint-policy decision, not a fix)
- **Phase:** 7
- **Audit ID:** F-50
- **Files:** representative sites —
  `client/src/components/canvas/SimulationScene.tsx:1355`, `:1370`, `:1609`, `:1611`
  (`initialTransforms` / `initialGroupTransforms` `Map.get`); 67 sites codebase-wide
- **Description:** Non-null assertions on `Map.get` results. The cited maps are built
  from the same `shapes` / `groupMapping` memos in the same render, so they hold today —
  but these assertions are the mechanism by which a future data inconsistency becomes a
  crash rather than a warning.
- **Trigger:** Any desync between the memos that populate those maps.
- **Evidence:** Static/read-only finding, no repro test. Count from the
  `tseslint.configs.strict` run, which reports `no-non-null-assertion` × 67.
- **Suspected fix:** Not a bulk fix — treat as a policy decision on whether to enable
  the rule, then handle the genuinely unguarded sites individually.
- **Related:** BUG-041 (what turns these into blank pages).

#### BUG-052 — `@deprecated getBasicGeom` is still on the live CSG path

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — Phase 7 session (deprecated alias removed; callers use getCachedGeometry)
- **Phase:** 7
- **Audit ID:** F-52
- **Files:** `client/src/lib/geometryCache.ts:18-27` (deprecation),
  `client/src/components/canvas/utils/geometryHelpers.ts:98` (live use)
- **Description:** Marked `@deprecated` and kept as a thin alias after the
  drifted-recipe bug it caused. It is still live: `geometryHelpers.ts:98` routes all of
  `makeBasicGeom` through it, so removing it means touching the CSG brush path.
- **Trigger:** Informational. No current misbehaviour — the alias delegates correctly.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Point `makeBasicGeom` at `getCachedGeometry` directly and delete
  the alias.
- **Related:** BUG-053 (documentation debt).

#### BUG-053 — Stale `NOTE` marker and stale `AGENTS.md` claims

- **Severity:** Minor
- **Status:** Fixed 2026-08-13 — Phase 7 session (AGENTS.md corrected; CadStudio NOTE left as accurate)
- **Phase:** 7
- **Audit ID:** F-53
- **Files:** `client/src/pages/CadStudio.tsx:164` (the `NOTE` marker);
  `AGENTS.md` (§Commands, §CSG)
- **Description:** `CadStudio.tsx:164` carries
  `NOTE: group-joint metadata lives on 'groups' (Option 2).` — informational, documents
  a design decision, no action implied. Recorded here because the audit brief asked for
  every TODO/FIXME/HACK/NOTE marker to be listed rather than silently skipped; there are
  only three in the entire repo (the other two are BUG-027 and BUG-052). Separately,
  `AGENTS.md` has gone stale in two ways this audit surfaced: it states "There is no test
  runner configured in `client/package.json`" (vitest is now configured with an
  `npm test` script and a `vitest.config.ts`), and it presents `lib/useCSGWorker.ts` as
  the live CSG path that `CSGGroup.tsx` consumes (BUG-050 verified it has zero call
  sites).
- **Trigger:** Misleads any agent or contributor reading `AGENTS.md` for orientation.
- **Evidence:** Static/read-only finding, no repro test.
- **Suspected fix:** Update the two stale `AGENTS.md` sections. Leave the `CadStudio`
  `NOTE` as-is — it is accurate.
- **Related:** BUG-050 (the dead code `AGENTS.md` still documents as live).

---

# Prioritised top 5

Carried over from the audit's own ranking, re-keyed to this document's IDs, with one
added column: whether the fix is complex enough to deserve its own plan-then-prompt pass
(the treatment the vehicle-joint and Tier 1a/1b work each received) or is small enough to
fix directly.

| Rank | ID | Finding | Severity | Own planning pass? | Reason for the ranking |
|---:|---|---|---|:---:|---|
| 1 | [BUG-001](#bug-001--getbodyref-collapses-two-rigidbodies-onto-one-ref-producing-a-degenerate-self-joint) | `getBodyRef` ref collision → degenerate self-joint | Critical | **Yes** | The only mechanism found for the open vehicle bug; three prior anchor fixes failed against it, so the anchor arithmetic may have been correct all along. Confirm before any further anchor work. |
| 2 | [BUG-035](#bug-035--glbshapemesh-disposes-geometry-it-does-not-own) | `GlbShapeMesh` disposes drei's shared cached geometry | Critical | No | Trivially reproducible by a user, and the symptom (unrelated models going blank) points nowhere near the cause. Urgent, not complex. |
| 3 | [BUG-018](#bug-018--torus-volume-formula-has-r-and-r-swapped) | Torus volume formula, R and r swapped | Critical | No | Two-character fix with a measured expected value already encoded in the repro. |
| 3 | [BUG-017](#bug-017--membercollider-splits-composite-mass-evenly-not-by-volume) | `MemberCollider` splits mass evenly, not by volume | Critical | **Yes** | Breaks documented legacy parity — needs a decision about what that changes, not just an edit. |
| 4 | [BUG-009](#bug-009--cache-poisoning-a-superseded-request-writes-its-result-under-the-wrong-key), [BUG-010](#bug-010--worker-error-leaves-the-body-permanently-kinematic), [BUG-011](#bug-011--re-voxelization-drops-every-collider-off-a-live-dynamic-body) | Voxel worker's three silent-failure states | Critical | **Yes** | Three interacting state-machine bugs in one hook; fixing one in isolation risks masking the others. Newest and least-exercised code in the repo. |
| 5 | [BUG-041](#bug-041--no-error-boundary-anywhere-in-the-route-tree) | No route-level error boundary | Critical | No | Small, but fallback placement and UX are a judgement call. Changes the failure mode of everything above it. |
| 5 | [BUG-044](#bug-044--unguarded-jsonparse-of-cad-studio-paths-crashes-the-simulation-page) | Unguarded `JSON.parse` of `cad-studio-paths` | Critical | No | Add the `try/catch` its three neighbours already have. |

Ranks 3 and 5 each cover two findings that the audit grouped as a single priority; they
are listed separately here because their planning-pass answers differ.
