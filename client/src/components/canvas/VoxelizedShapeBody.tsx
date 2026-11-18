import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import type { Evaluator } from "three-bvh-csg";
import type { ShapeType } from "../../pages/CadStudio";
import { useVoxelCollider } from "../../lib/useVoxelCollider";
import {
  buildGlbShapeVoxelInput,
  packageCustomShapeVoxelInput,
  serializeMembers,
} from "../../lib/hollowShapeVoxelization";
import { useCSGWorker, extractGlbArrays } from "../../lib/useCSGWorker";
import { serializeCustomMembers, collectGlbUrlsFromCustomMembers } from "./utils/csgKeys";
import { isCSGResultCurrent } from "../../lib/voxelInputGate";
import type { GlbGeometryArrays } from "../../lib/workerGlbRegistry";
import "../../lib/csgProbe";

// DEV-only, per-frame physics telemetry — separate from window.__csgProbe
// (that one is about CSG-recompute state; this is about the RigidBody's
// actual world state, same role window.__vehicleProbe plays for the demo
// car in SimulationScene.tsx). Lets an e2e check confirm the body never
// falls through the floor and never silently loses its collider during a
// CSG-fold-triggered recompute, not just that the CSG state machine looks
// right — the two are checked independently on purpose.
type VoxelizedBodyProbeEntry = {
  position: [number, number, number];
  bodyType: number | null;
  sleeping: boolean | null;
  colliderCount: number;
};

declare global {
  interface Window {
    __voxelizedBodyProbe?: Record<string, VoxelizedBodyProbeEntry>;
  }
}

type VoxelizedShapeBodyProps = {
  shape: ShapeType;
  position: [number, number, number];
  rotation: [number, number, number];
  linearDamping: number;
  angularDamping: number;
  friction: number;
  restitution: number;
  mass: number;
  enabledRotations: [boolean, boolean, boolean];
  meshContent: React.ReactNode;
  meshScale: [number, number, number];
  meshRotation: [number, number, number];
  evaluator: Evaluator;
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>;
  bodyRef: React.RefObject<any>;
  onPointerDown: (e: any) => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
};

/**
 * Renders a dynamic hollow "custom"/"glb" shape (a CSG boolean-subtract
 * result, or an imported model with a real cavity) using the voxel-based
 * compound collider instead of a single hull that would fill the hole in.
 * Voxelization runs in a Web Worker and can take a noticeable moment for a
 * complex shape (measured up to ~86ms for a 4-hole part with BVH-accelerated
 * raycasting) — the body is held kinematic (frozen in place, but a fully
 * valid physics/joint reference) until the real colliders resolve, then
 * flips to dynamic, rather than simulating against a placeholder box that
 * would itself briefly reproduce the exact "hole filled with material" bug
 * this whole thing exists to fix.
 */
export default function VoxelizedShapeBody({
  shape,
  position,
  rotation,
  linearDamping,
  angularDamping,
  friction,
  restitution,
  mass,
  enabledRotations,
  meshContent,
  meshScale,
  meshRotation,
  // No longer read: the CSG fold now runs in a worker with its own
  // Evaluator instance (csgEvaluation.ts), so this component no longer
  // needs the caller's shared one. Kept as an accepted prop so callers
  // don't need changes just because this component stopped needing it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  evaluator,
  gltfGeometryMap,
  bodyRef,
  onPointerDown,
  onPointerOver,
  onPointerOut,
}: VoxelizedShapeBodyProps) {
  const { compute, boxes, loading } = useVoxelCollider();

  // The CSG fold for a "custom" shape now runs off the main thread
  // (lib/useCSGWorker.ts) instead of synchronously inside the voxelInput
  // useMemo below — see hollowShapeVoxelization.ts's
  // packageCustomShapeVoxelInput doc comment. "glb" shapes are unaffected:
  // buildGlbShapeVoxelInput just clones an already-loaded geometry, no CSG
  // fold involved, so it stays exactly as it was.
  const needsCSGFold = shape.type === "custom" && !!shape.customMembers && shape.customMembers.length > 0;

  const csgDepsKey = useMemo(
    () => `${serializeCustomMembers(shape.customMembers)}|color:${shape.color || ""}`,
    [shape.customMembers, shape.color],
  );
  const neededGlbUrls = useMemo(
    () => collectGlbUrlsFromCustomMembers(shape.customMembers),
    [shape.customMembers],
  );
  const allGlbArrays = useMemo(() => {
    const map = new Map<string, GlbGeometryArrays>();
    gltfGeometryMap?.forEach((geom, url) => map.set(url, extractGlbArrays(geom)));
    return map;
  }, [gltfGeometryMap]);

  const {
    compute: computeCSG,
    result: csgResult,
    resolvedKey: csgResolvedKey,
    error: csgError,
    droppedCount: csgDroppedCount,
  } = useCSGWorker();

  useEffect(() => {
    if (!needsCSGFold) return;
    const filtered = new Map<string, GlbGeometryArrays>();
    neededGlbUrls.forEach((url) => {
      const arrays = allGlbArrays.get(url);
      if (arrays) filtered.set(url, arrays);
    });
    computeCSG(
      csgDepsKey,
      { kind: "members", members: shape.customMembers!, fallbackColor: shape.color },
      filtered,
    );
  }, [needsCSGFold, csgDepsKey, shape.customMembers, shape.color, neededGlbUrls, allGlbArrays, computeCSG]);

  // Not silent (Phase-1 no-empty-catch standard, BUG-046). No new
  // user-facing event: this pipeline has none today, and its existing
  // fallback (below — hold lastGoodBoxes, or the NULL_INPUT_GRACE_MS timeout
  // if nothing has ever resolved) already covers what a user sees, same as
  // it already does for a genuine voxelization-stage failure. A CSG failure
  // just means voxelInput stays null, which that existing machinery already
  // handles correctly.
  useEffect(() => {
    if (!csgError) return;
    console.warn(`[VoxelizedShapeBody] CSG fold failed for shape ${shape.id}: ${csgError}`);
  }, [csgError, shape.id]);

  const voxelInput = useMemo(() => {
    if (shape.type === "custom") {
      // isCSGResultCurrent rejects a stale result left over from before
      // shape.customMembers changed — see voxelInputGate.ts's doc comment.
      // Packaging it anyway would poison useVoxelCollider's cache under the
      // NEW cacheKey with the OLD (pre-edit) geometry.
      if (!isCSGResultCurrent(csgResolvedKey, csgDepsKey, csgResult?.positions.length)) return null;
      return packageCustomShapeVoxelInput(shape, csgResult!.positions, csgResult!.indices);
    }
    if (shape.type === "glb" && gltfGeometryMap) {
      return buildGlbShapeVoxelInput(shape, gltfGeometryMap);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shape.type,
    shape.scale.join(","),
    shape.color,
    shape.url,
    csgResolvedKey,
    csgDepsKey,
    csgResult,
    // Was JSON.stringify, which throws on a cyclic member tree and re-walks
    // the whole tree every render. serializeMembers is cycle-safe and covers
    // exactly the fields that change the resulting geometry.
    serializeMembers(shape.customMembers),
    gltfGeometryMap,
  ]);

  useEffect(() => {
    if (!voxelInput) return;
    compute(voxelInput.cacheKey, voxelInput.positions, voxelInput.indices, voxelInput.featureRegions);
    // compute() itself no-ops on an unchanged key, so this is safe to call
    // on every relevant re-render rather than needing its own guard here.
  }, [voxelInput, compute]);

  // A null voxelInput means compute() is never called, so `loading` stays
  // false and `boxes` stays null — and the resolved check below reads that as
  // "not finished yet" and holds the body kinematic forever, with no collider
  // and no error. Reachable whenever a glb's URL is missing from
  // gltfGeometryMap (still loading, or the merge failed — BUG-046), and now
  // also while the CSG fold above hasn't resolved for the current key yet.
  // Give it a bounded grace period, then treat it as a resolved failure so
  // the fallback collider mounts and the body goes dynamic. See BUG-013.
  // The CSG fold measured up to ~200ms even for a heavy fixture (30
  // members), nowhere near this 5s window, so it never trips this path in
  // the ordinary case — only a genuinely stuck/failed fold or a slow GLB
  // load does.
  const NULL_INPUT_GRACE_MS = 5000;
  const [inputTimedOut, setInputTimedOut] = useState(false);
  useEffect(() => {
    if (voxelInput) {
      setInputTimedOut(false);
      return;
    }
    const t = setTimeout(() => setInputTimedOut(true), NULL_INPUT_GRACE_MS);
    return () => clearTimeout(t);
  }, [voxelInput]);

  // Last non-empty box set, kept mounted across a re-voxelization.
  //
  // `ready` used to go false the moment a recompute started, which unmounted
  // every CuboidCollider — on a body that had already flipped to dynamic. A
  // dynamic body with zero colliders falls straight through the floor. The
  // kinematic hold only ever protected the FIRST resolve, so any later change
  // (a live edit, a motor-driven scale, a GLB finishing its load and mutating
  // gltfGeometryMap) dropped the shape out of the world. Holding the previous
  // colliders is briefly stale but always physical. See BUG-011.
  const lastGoodBoxes = useRef<typeof boxes>(null);
  if (boxes && boxes.length > 0) lastGoodBoxes.current = boxes;

  // `inputTimedOut` counts as resolved: there is nothing to wait for.
  const resolved = (!loading && boxes !== null) || inputTimedOut;
  const failed = resolved && (boxes === null || boxes.length === 0);
  // `boxes` can be null while `resolved` is true (the inputTimedOut path), so
  // this must not dereference it unguarded.
  const displayBoxes = boxes && boxes.length > 0 ? boxes : lastGoodBoxes.current;
  const ready = !!displayBoxes && displayBoxes.length > 0;
  const wasResolved = useRef(false);

  // DEV-only telemetry, same shape/convention as CSGGroup.tsx's and
  // CustomShapeMesh.tsx's window.__csgProbe — keyed by shape id.
  //
  // `isStale` here means something specific to this two-stage pipeline, not
  // a naive `displayBoxes !== boxes` check: while the CSG-fold stage is
  // racing (csgResolvedKey behind csgDepsKey), `voxelInput` stays null the
  // entire time, so the voxelization stage's `compute()` is never even
  // dispatched — `boxes` just sits on whatever it last held, unchanged.
  // `displayBoxes` and `boxes` are therefore IDENTICAL throughout a CSG
  // race (lastGoodBoxes never even gets consulted), even though what's
  // being shown genuinely is older than the latest edit. The real signal
  // for "showing a stale-but-valid collider while a newer edit is still in
  // flight" is csgResolvedKey !== csgDepsKey combined with already having
  // something to show.
  useEffect(() => {
    if (!(process.env.NODE_ENV !== "production")) return;
    if (!window.__csgProbe) window.__csgProbe = {};
    window.__csgProbe[String(shape.id)] = {
      lastRequestAt: null,
      lastResolveAt: resolved ? performance.now() : null,
      usingFallback: !ready,
      droppedCount: csgDroppedCount(),
      currentComputeKey: csgDepsKey,
      resolvedKey: csgResolvedKey,
      isStale: ready && csgResolvedKey !== csgDepsKey,
    };
  });

  useEffect(() => {
    // Flip to dynamic once voxelization has resolved either way — a
    // genuine failure still gets the fallback collider below and should
    // still go dynamic, not sit kinematic forever.
    if (resolved && !wasResolved.current && bodyRef.current) {
      // 0 = RigidBodyType.Dynamic in this Rapier version, matching the
      // existing pointer-grab kinematic<->dynamic swap in SimulationScene.
      bodyRef.current.setBodyType(0);
      bodyRef.current.wakeUp();
    }
    wasResolved.current = resolved;
  }, [resolved, bodyRef]);

  useFrame(() => {
    if (!(process.env.NODE_ENV !== "production") || !bodyRef.current) return;
    if (!window.__voxelizedBodyProbe) window.__voxelizedBodyProbe = {};
    const t = bodyRef.current.translation();
    window.__voxelizedBodyProbe[String(shape.id)] = {
      position: [t.x, t.y, t.z],
      bodyType: bodyRef.current.bodyType?.() ?? null,
      sleeping: bodyRef.current.isSleeping?.() ?? null,
      colliderCount: bodyRef.current.numColliders?.() ?? 0,
    };
  });

  // Fallback bounding box, used only if voxelization comes back with zero
  // boxes (a degenerate/failed result) — strictly better than no collider
  // at all (which would fall through the floor), even though it reopens
  // the hole in that rare failure case.
  const fallbackHalfExtents = useMemo((): [number, number, number] => {
    const sx = Math.max(0.005, shape.scale[0]) / 2;
    const sy = Math.max(0.005, shape.scale[1]) / 2;
    const sz = Math.max(0.005, shape.scale[2]) / 2;
    return [sx, sy, sz];
  }, [shape.scale]);

  // Derived from the boxes actually RENDERED, so the per-collider mass
  // fractions always sum to `mass` even while showing a held-over set.
  const totalVolume = useMemo(() => {
    if (!displayBoxes || displayBoxes.length === 0) return 0;
    return displayBoxes.reduce((sum, b) => sum + b.volume, 0) || 1;
  }, [displayBoxes]);

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      position={position}
      rotation={rotation}
      colliders={false}
      linearDamping={linearDamping}
      angularDamping={angularDamping}
      friction={friction}
      restitution={restitution}
      // No `mass` prop: it is a no-op on <RigidBody> in @react-three/rapier
      // v2.2.0. This body's mass comes from the CuboidColliders below, which
      // split `mass` by voxel volume, or from the fallback collider. See
      // BUG-006.
      // This body flips to dynamic imperatively (setBodyType) once
      // voxelization resolves, not via this prop — the JSX type stays
      // "kinematicPosition" forever, so ccd has to be set unconditionally
      // here rather than gated on it. Harmless while kinematic; matters
      // once dynamic, same reasoning as the other RigidBody instances: a
      // fast motor can sweep a thin collider wall past a contact surface
      // within one discrete timestep even with fully correct geometry.
      ccd
      enabledRotations={enabledRotations}
    >
      <group
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        scale={meshScale}
        rotation={meshRotation}
      >
        {meshContent}
      </group>

      {ready && displayBoxes ? (
        displayBoxes.map((b, idx) => (
          <CuboidCollider
            key={`voxel-collider-${shape.id}-${idx}`}
            args={b.halfExtents}
            position={b.center}
            mass={mass * (b.volume / totalVolume)}
            friction={friction}
            restitution={restitution}
          />
        ))
      ) : failed ? (
        // Voxelization genuinely resolved to nothing — fall back to a
        // bounding box rather than leaving the body with no collider at
        // all (which would fall through the floor). This does briefly
        // reopen the hole, but only in this rare failure case.
        <CuboidCollider
          key={`voxel-fallback-${shape.id}`}
          args={fallbackHalfExtents}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      ) : null /* still loading — no collider yet. The body stays
      kinematic during this window (not simulated, but still a valid
      collision/joint target), so rendering nothing here is safe and
      avoids briefly covering the hole with a placeholder collider — the
      exact bug this whole feature exists to fix, just time-boxed. */}
    </RigidBody>
  );
}
