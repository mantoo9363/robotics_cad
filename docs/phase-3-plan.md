# Phase 3 plan — Vehicle / joint cluster (BUG-001 … BUG-008)

**Status:** in progress — Gates A/B passed, Gate C automated and green; 7 findings landed (BUG-001/003/004/006/007/008 + BUG-054). **BUG-002 and BUG-005 remain.**
**Source:** [bug-audit-2026-08.md](./bug-audit-2026-08.md) §A, Phase 3.
**Date:** 2026-08-13

> ## Execution log
>
> | Step | Outcome |
> |---|---|
> | **Gate A** — does the traction bug still reproduce? | **NO** (2026-08-13). Closed by the `RaycastVehicle` replacement. No anchor or inertia re-attempt will be scheduled. Recorded in [§A of the tracking doc](./bug-audit-2026-08.md#a--vehicle-physics--joint-anchoring). |
> | **1. BUG-001** — ref-keying fix | **Done** (2026-08-13). `getBodyRef` now keys on disjoint `group:` / `shape:` namespaces; the group body is keyed on the group id rather than on `members[0]`. F-08 repro tests flipped (6 tests, incl. a control and a demo-car no-op guard). tsc clean, 66/66 suite green. |
> | **Gate B** — driving test, no-regression | **PASSED** (2026-08-13, user-verified). |
> | **3. BUG-004** — group frame | **Done.** Centroid + identity; the three consumers that read `memberTransforms[0].rotation` directly now read `anchorRot`. |
> | **4. BUG-003** — comment correction | **Done.** Determined the comment was stale, not the usage — see §A of the tracking doc. |
> | **BUG-006 / BUG-007 / BUG-008** (parallel track) | **Done.** No-op `mass` props removed; `sortMotorGroups` is now a topological sort (6 real-function tests); unresolvable motor pivot skips the group instead of rotating about the world origin. |
> | **Gate C** — driving test + a rotated-`members[0]` group scene | **Demo-car half now automated and PASSING** — `npm run test:e2e` is 6/6 green. The rotated-`members[0]` scene still needs building by hand. |
> | **BUG-054** — sleeping chassis (found 2026-08-13) | **Fixed.** `canSleep={false}` on vehicle chassis. Pre-existing, not a Phase 3 regression. |
> | **Stop/idle/resume report** (2026-08-13) | **Pre-existing, not a Phase 3 regression** — proven by static reachability, see below. Root-caused to a sleeping chassis and filed as [BUG-054](./bug-audit-2026-08.md#bug-054--sleeping-chassis-silently-discards-all-vehicle-engine-force). Gate C is therefore still evaluable as "no new regression, separate pre-existing issue found". |
>
> Since Gate A returned NO, everything below that is conditioned on "if the traction
> bug reproduces" is now moot and retained only as a record of the reasoning.

---

## Headline finding

> **BUG-001 is a SEPARATE bug from the previously-reverted traction investigation.**
> Not the same bug, and not a contributing factor. It cannot fire in the demo car
> at all — on two independent grounds — and the working hypothesis that it explains
> the three failed anchor-fix attempts is **refuted**.

There is a second, larger consequence that reshapes this whole phase:

> **The code the traction bug lived in no longer exists in the working tree.** The
> committed version (`HEAD`, c3441ab) drove wheels with revolute joints
> (`SimulationMotorJoint` → `useRevoluteJoint(chassisRef, wheelRef, …)`). The
> uncommitted working tree replaced that entire mechanism with Rapier's raycast
> vehicle controller (`RaycastVehicle`), which has no joints and no wheel rigid
> bodies. The joint anchors that the reverted work was trying to fix are gone.

So the first question this phase must answer is not "how do we fix the anchors" —
it is **"does the traction bug still reproduce at all?"** That has never been
tested against the current working tree.

---

## Evidence

Reproduced with `scratchpad/phase3-bug001-live-check.mjs`, which transcribes the
demo car verbatim from `CadStudio.tsx:2337-2653` (`confirmLoadDemoCar`) and runs it
through faithful re-implementations of `getRootGroupId`, `getBodyRef`,
`unGroupedShapes`, `groupMapping` and the vehicle/custom-motor split.

### 1. No shape in the demo car meets BUG-001's condition

BUG-001 requires a motor group's **driven member** that is **also parented into a
group**. In the demo car those sets are disjoint:

| | Shape ids |
|---|---|
| Grouped (`parentId: 3001`) | 1001 chassis, 1008–1021 body parts — **15 shapes** |
| Standalone (no `parentId`) | 1002–1005 wheels, 1006–1007 knuckles — **6 shapes** |
| Driven motor-group members | 1002–1007 — **exactly the standalone set** |
| **Meeting BUG-001's condition** | **none** |

The wheels and knuckles are declared *without* spreading `bodyPartDefaults`
(`CadStudio.tsx:2522-2605`), so they never receive `parentId`. Every RigidBody in
the scene resolves to a distinct ref key:

```
1006 <- standalone FL Steering Knuckle      1002 <- standalone Front Left Wheel
1007 <- standalone FR Steering Knuckle      1003 <- standalone Front Right Wheel
1004 <- standalone Rear Left Wheel          1005 <- standalone Rear Right Wheel
1001 <- group body 3001 [15 members]
=> NO COLLISION
```

### 2. The demo car never creates a revolute joint

All four motor groups carry `vehicleRole: "drive"` or `"steer"`, so they route to
`RaycastVehicle`. `CustomRevoluteMotor` — the only call site of `useRevoluteJoint`
in the working tree, and the sole place BUG-001's degenerate self-joint can
manifest — is instantiated **zero times** in this scene. Even a ref collision
would have nothing to feed.

### 3. The joint-based wheel system was replaced, not fixed

| | `HEAD` (c3441ab) | Working tree |
|---|---|---|
| Wheel drive | `SimulationMotorJoint` → `useRevoluteJoint(chassisRef, wheelRef, …)` | `RaycastVehicle` (raycast controller) |
| Wheel bodies | own `RigidBody` per wheel (`isWheel` branch) | none — plain visual `<group>`, no collider |
| `useRevoluteJoint` uses | wheels + custom motors | custom motors only |
| `getBodyRef` | *byte-identical to working tree* | *byte-identical to HEAD* |

`SimulationScene.tsx:484-494` states this outright: the raycast controller "sidesteps
the wheel-joint/compound-chassis-inertia instability class entirely: wheels here are
virtual raycasts, not separate bodies with their own anchors that could ever mismatch
the chassis's true origin."

That is the reverted investigation's *workaround*, already in the tree.

### What this does and doesn't tell us

- BUG-001 is **real** (the repro test stands) but scoped to **custom-motor scenes**
  where a driven shape is grouped — not to vehicles.
- `getBodyRef` is unchanged from HEAD, so BUG-001 is **pre-existing**, not introduced
  by the uncommitted work.
- The three failed anchor-fix attempts remain **unexplained**. BUG-001 is no longer a
  candidate. Since the code they targeted has been replaced, the most economical
  position is to treat that investigation as **closed by replacement** unless the
  traction symptom reproduces again — see Gate A.
- The compound-chassis inertia-tensor instability was never inspected and is still
  **unresolved in principle**, but it too lived in the wheel-joint system. Whether it
  still has a live host in the raycast path is unknown and is exactly what Gate A tests.

---

## Per-finding plans

### BUG-001 — `getBodyRef` ref collision → degenerate self-joint · Critical

**Confirmed real, but not the traction bug.** Affects custom-motor scenes only.

The defect is that `getBodyRef` has two different jobs fused into one function:
*"which RigidBody does this shape belong to"* and *"which RigidBody is the group
this shape is in"*. For a driven member the answers differ, and the current code
picks by array position (`groupMembers[0].id`) rather than by role.

**Recommended fix location: `getBodyRef` itself.** The alternatives are worse —
changing `unGroupedShapes`/`groupMapping` would alter which bodies exist rather
than which ref they get, and patching `CustomRevoluteMotor` would fix one call
site while leaving the shared helper wrong for future ones.

Shape of the fix (to be detailed at implementation time):

- Key group bodies on the **group id**, not on a member's shape id. The group body
  is a property of the group; keying it on whichever member happens to sort first
  is the root cause of both this bug and BUG-004's frame instability.
- Give driven members their own key unconditionally, since they always render their
  own standalone body (`unGroupedShapes` already guarantees this).
- Keep one map, but with a discriminated key (e.g. `group:3001` vs `shape:1002`) so
  a group id and a shape id can never alias.

**Verification:** the existing `bugAuditRepro.test.ts` → `F-08` block already
encodes the collision and the ordering dependence; flip those to assert distinct
keys. Add a case asserting a group body and a driven member of that group never
share a key regardless of array order.

**Note:** this is a latent-severity fix. It has no effect on the demo car. It should
still be done — a user building a grouped custom-motor rig hits it — but it must not
be sold as a traction fix.

---

### BUG-003 — `getChassisWorldTransform` feeds a live joint anchor · Moderate

**Answer to the question posed: the comment is stale. The usage is correct.**

The comment (`:1150-1159`) says the function is safe "specifically because it only
ever feeds a one-time `RaycastVehicle` wheel config, never a live joint anchor that
gets mutated at runtime." Line 1845 does use it for `CustomRevoluteMotor`'s
`anchor1`. But the usage is sound, for two reasons:

1. **The anchors are not mutated at runtime.** `CustomRevoluteMotor` passes
   `anchor1`/`anchor2` into `useRevoluteJoint` once at creation and thereafter only
   calls `configureMotorVelocity`. The comment's stated hazard does not occur.
2. **The frames agree.** For a grouped pivot, `pivotRef = getBodyRef(pivotShapeId)`
   resolves to the group body, whose `position`/`rotation` props are
   `groupOrigin` / `memberTransforms[0].rotation` — and `getChassisWorldTransform`
   returns `initialGroupTransforms.get(rootId)`, which *is* that same pair. anchor1
   is therefore measured from the body origin it is attached to. That is what
   correctness requires.

**Recommended action:** rewrite the comment to state the real invariant — *"safe
wherever the consumer attaches to the body this transform describes; verify frame
agreement before reusing"* — rather than the incidental one it currently claims.
**No behavioural change.** This is a documentation fix, and it should land only
after Gate A, because if the traction symptom does reproduce, this comment is one of
the first places the next investigator will look and it should not be rewritten out
from under them.

**Dependency on BUG-001:** none in either direction. BUG-001's fix changes *which
ref* is returned; BUG-003 concerns *which transform* is measured. They are
independent, but both should be re-checked together once BUG-001 lands, since a
changed group-body key must keep the frame agreement in point 2 intact.

---

### BUG-004 — group body mixes centroid origin with first-member rotation · Moderate

**Recommendation: standardize on centroid origin + identity rotation.**

The audit framed this as "position and rotation come from different reference
frames". That is descriptively true but not, on its own, incorrect — every consumer
(member local transforms, colliders, meshes, wheel connection points, joint anchors)
uses the same `qAnchor`, so the frame is self-consistent.

**The actual defect is that the frame depends on array order.** `memberTransforms[0]`
is whichever member sorts first. Reorder the shapes array — an undo, a re-group, a
load from a different source — and the entire group's rest orientation changes, so
every member's local transform changes with it. That is the same order-dependence
class as BUG-001, in a different function.

Why identity rotation:

- **Order-independent.** The centroid is order-invariant; identity trivially so. The
  whole failure mode disappears rather than being made less likely.
- **Already effectively true for the demo car**, whose `members[0]` is the chassis at
  rotation `[0,0,0]` — so this scene sees no change at all, which makes it a safe
  thing to land before the harder work.
- **Simplifies the local math.** With `qAnchor = identity`, `qLocal = qAnchorInv *
  qChild` collapses to `qChild`: each member simply carries its own world rotation.

**Risk / migration:** any scene whose `members[0]` has a non-identity rotation will
see its group body's rest orientation change. Members' local rotations compensate
exactly, so the *rendered* result should be identical — but this must be confirmed
visually, not assumed. Test with a group deliberately authored so `members[0]` is
rotated.

**Interaction with BUG-001/003:** all three touch the group-body reference frame, and
BUG-001's fix (keying group bodies on group id) makes this one easier — once the
group body is identified by the group rather than by `members[0]`, taking its
orientation from `members[0]` is visibly the odd one out. **Do BUG-001 first.**

---

### The five more-independent findings

| ID | Fix | Parallel-safe? |
|---|---|---|
| **BUG-002** — chassis mass read once, before async colliders resolve | Re-read chassis mass and re-apply `setWheelMaxSuspensionForce` when it changes, or defer controller creation until mass > 0. Prefer the latter: it is one guard in the existing lazy-creation branch (`:554`) rather than a per-step recomputation. | **No** — same file and same function as Gate A's instrumentation (`RaycastVehicle`). Sequence after Gate A. |
| **BUG-005** — `scaleMultiplier` id/name heuristic | Derive from `vehicleConfigs[].wheels[].radius` (already computed, `:1229`) instead of `shapes.find(id === 1002 \|\| name includes "wheel")`. Falls back to 1.0 when there are no wheels. | **No** — directly changes engine/brake force, which is the quantity Gate A measures. Must not move during Gate A. |
| **BUG-006** — `<RigidBody mass>` is a no-op | Documentation + removal of the misleading props. Verified against library source: `rigidBodyDescFromOptions` applies only `type`/`canSleep`, `mutableRigidBodyOptions` has no `mass` handler, and `cleanRigidBodyPropsForCollider` strips `mass` before colliders inherit it. Currently compensated everywhere because each collider sets its own mass. | **Yes** — inert by construction. Safe any time. |
| **BUG-007** — `sortMotorGroups` invalid comparator | Replace with an explicit topological sort over the pivot/containment dependency graph, computed once per motor-group change rather than per frame (`useFrame`). | **Yes** — lives in `kinematicsUtils.ts`, consumed by `KinematicNode` (the CAD editor's preview), not by `SimulationScene`. No overlap with the vehicle path. |
| **BUG-008** — motor pivot falls back to world origin | Skip the motor group when its pivot cannot be resolved, instead of silently rotating about `(0,0,0)`; and prune dangling `pivotShapeId` on shape deletion. The second half is an authoring-side change in `CadStudio.tsx` and may be worth splitting out. | **Yes** — `KinematicNode.tsx`, same reasoning as BUG-007. |

---

## Ordering

```
GATE A  Re-test the traction bug on the current working tree      ← HARD GATE
   |     demo car + drive input. Does it still reproduce?
   |
   +-- NO  -> traction bug is closed by the RaycastVehicle replacement.
   |          Record that in the tracking doc. Skip the anchor/inertia
   |          re-attempt entirely. Proceed to BUG-001 as an ordinary
   |          latent-severity fix.
   |
   +-- YES -> STOP. Do not fix anything in this phase yet.
              The symptom has a new mechanism (the old one is gone), so it
              needs its own diagnosis before any code moves. Re-scope.

  1. BUG-001   ref-keying fix + flip the F-08 repro tests
  2. GATE B    re-run the driving test — confirms no regression       ← HARD GATE
  3. BUG-004   centroid + identity frame (depends on 1)
  4. BUG-003   comment correction (trivial once 1 and 3 have settled)
  5. GATE C    driving test + a rotated-members[0] group scene        ← HARD GATE
  6. BUG-002   chassis mass timing
  7. BUG-005   scaleMultiplier derivation
  8. GATE D    driving test — 6 and 7 both change vehicle forces      ← HARD GATE

  Anytime, in parallel, by anyone:  BUG-006, BUG-007, BUG-008
```

**Hard gates** are A, B, C, D — each must pass before the next numbered step starts.
Gate A is the important one: it determines whether this phase is "five latent fixes"
or "a fresh investigation".

**Reorderable:** BUG-006/007/008 have no dependency on anything above and touch
different files (`kinematicsUtils.ts`, `KinematicNode.tsx`, prop cleanup). BUG-003
and BUG-004 can swap, though 004-then-003 reads better since 003's comment should
describe the final frame convention. BUG-002 and BUG-005 can swap freely.

**Deliberately not in this phase:** any re-attempt at the reverted anchor fix, and
any inertia-tensor work. Both are gated behind Gate A returning YES. Bundling them in
now would be re-fixing code that no longer exists.

---

## Testing plan

Unit tests cannot settle this phase. The original bug was only ever confirmed or
denied by driving the car, and the raycast controller's behaviour is emergent from
suspension, friction and contact — none of which a node-environment test reaches.

### Operational definition of "fixed"

Per run, with the demo car loaded and simulation playing:

| Criterion | Measurement | Pass |
|---|---|---|
| **Translates under drive** | chassis world position delta along its own forward axis, from `W` held 3 s | > 5 world units |
| **Accelerates** | forward speed at t=1s vs t=3s | monotonically increasing, then plateaus |
| **Wheels roll rather than spin in place** | chassis displacement vs. integrated wheel roll angle × radius | within ~25 % — the existing rolling-without-slipping model, so exact agreement is not expected |
| **No solver explosion** | chassis \|position\| and \|linvel\| over 30 s idle + 30 s driving | both finite, position stays within the 150-unit ground plane |
| **Rests stably** | chassis Y over 10 s with no input | settles, does not sink through the ground or creep upward |
| **Resumes after idle** | drive, release, idle >6 s (past Rapier's sleep threshold), drive again | car translates on the second input exactly as on the first — **this is BUG-054's sequence, and was not covered before 2026-08-13** |
**Was automated, no longer runnable.** The whole table above used to be checked by `npm run test:e2e` (`client/e2e/driveDemoCar.mjs`), which drove the real app in Chrome over the DevTools Protocol and asserted on physics telemetry rather than pixels. That `e2e/` harness has since been removed (see AGENTS.md) — this table now needs checking by hand again, or a replacement harness, until it's rebuilt.
| **Steers** | `A` / `D` held 3 s | heading changes; car does not invert or launch |

The wheel-spin/translation pair is the one that matters most: the original symptom
was *wheels spin, car doesn't translate*, so a fix that makes wheels stop spinning
would also satisfy a naive "does it move" check while being wrong.

### Scenes

1. **Demo car** (`Load Demo Car`) — the scene that exhibited the original bug. Primary
   regression target for every gate.
2. **A grouped custom-motor rig** — the scene BUG-001 *does* affect: a driven shape
   parented into a group, with a `vehicleRole: "none"` motor group and a grouped
   pivot, authored so the driven member precedes the pivot in the shapes array.
   This has to be built by hand; no preset produces it. Confirms BUG-001's fix does
   something, since the demo car cannot.
3. **A vehicle without the BUG-001 condition** — the demo car is already this, which
   is convenient: it is simultaneously the regression case and the negative control
   for BUG-001. Passing gate B on the demo car confirms the ref-keying change did not
   disturb the working path.
4. **A group whose `members[0]` is rotated** — for Gate C only, to confirm BUG-004's
   frame change is visually neutral.

### Instrumentation

Gate A needs numbers, not impressions. Before testing, add a temporary
`useAfterPhysicsStep` probe logging chassis position, linear velocity, and
`controller.wheelSuspensionLength(i)` / `wheelIsInContact(i)` per wheel, at ~4 Hz.
Suspension contact is the fastest discriminator between the plausible failure modes:
wheels not touching the ground (suspension force too low — the BUG-002 family) looks
very different from wheels in contact but not gripping (friction/slip parameters).
Remove the probe before the phase closes.

---

## What to update in the tracking doc when this phase runs

- BUG-001's entry should gain a line recording that it does **not** reproduce in the
  demo car, so the next reader does not re-derive that.
- §A's "Fixed since this audit" stub gets the usual treatment per
  [Marking findings fixed](./bug-audit-2026-08.md#marking-findings-fixed).
- If Gate A returns NO, add a short note to §A recording the traction bug as closed by
  the `RaycastVehicle` replacement, with the HEAD-vs-working-tree evidence — that
  context is currently only in this plan and in an uncommitted diff.
