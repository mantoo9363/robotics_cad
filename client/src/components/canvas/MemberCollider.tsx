import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Evaluator } from "three-bvh-csg";
import type { ShapeType, CustomMember } from "../../pages/CadStudio";
import PrimitiveCollider from "./PrimitiveCollider";
import VoxelCompoundColliders from "./VoxelCompoundColliders";
import { getShapeColliderConfigs, calculateShapeVolume } from "../../lib/physicsUtils";
import {
  shouldVoxelizeShape,
  hasStructuralHoles,
  buildGlbShapeVoxelInput,
  packageCustomShapeVoxelInput,
  serializeMembers,
  type VoxelInput,
} from "../../lib/hollowShapeVoxelization";
import { useCSGWorker, extractGlbArrays } from "../../lib/useCSGWorker";
import { serializeCustomMembers, collectGlbUrlsFromCustomMembers } from "./utils/csgKeys";
import { isCSGResultCurrent } from "../../lib/voxelInputGate";
import type { GlbGeometryArrays } from "../../lib/workerGlbRegistry";

// Past this nesting depth a composite stops being decomposed and is treated as
// a single leaf instead. CompositeMemberColliders recurses as *React*
// components, so an unbounded tree blows the render stack rather than a plain
// call stack — there is no try/catch that helps, the whole route goes down.
// Real authored assemblies nest a handful of levels; 32 is far beyond anything
// legitimate and far below where the renderer struggles.
//
// sumLeafVolumes below applies the identical cap on purpose: it supplies the
// denominator for the mass split, so if the two disagreed the mass would be
// divided over a different set than the one that renders.
const MAX_COMPOSITE_DEPTH = 32;

// Immutable ancestor chain, unlike the mutable path set the pure walkers in
// hollowShapeVoxelization.ts use. React renders children *after* the parent
// returns, so add-before/delete-after around a recursive call does not work
// here — the set would be empty again by the time the child renders. Handing
// each child its own frozen copy is the version that survives that.
type MemberAncestors = ReadonlySet<CustomMember>;

type MemberColliderProps = {
  shape: ShapeType;
  position: [number, number, number];
  rotation: [number, number, number];
  isDynamic: boolean;
  evaluator: Evaluator;
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>;
  mass: number;
  friction: number;
  restitution: number;
  keyPrefix: string;
};

/**
 * Total VOLUME of the leaf parts a hole-free "custom" composite expands into,
 * under exactly the same traversal, cycle and depth rules
 * CompositeMemberColliders uses — the two must agree or the mass split is
 * computed over a different set than the one that renders.
 *
 * Volume, not count. The previous version divided the composite's mass evenly
 * across leaves regardless of their size, so a 200mm base plate and an M3
 * screw in one assembly each received half the mass: total mass right, centre
 * of mass and inertia tensor badly wrong. That even split existed to match the
 * old flat getCompoundColliders traversal — which was deleted as dead code in
 * BUG-033, removing the only reason to keep it. Every other collider path in
 * this codebase is already volume-weighted. See BUG-017.
 */
function sumLeafVolumes(
  members: CustomMember[] | undefined,
  parentScale: [number, number, number],
  ancestors: MemberAncestors = new Set(),
  depth = 0,
): number {
  if (!members) return 0;
  let total = 0;
  for (const m of members) {
    if (m.isHole) continue;
    const scale: [number, number, number] = [
      parentScale[0] * m.scale[0],
      parentScale[1] * m.scale[1],
      parentScale[2] * m.scale[2],
    ];
    const stop = ancestors.has(m) || depth >= MAX_COMPOSITE_DEPTH;
    if (
      m.type === "custom" &&
      m.customMembers &&
      !stop &&
      !hasStructuralHoles(m.customMembers)
    ) {
      const nested = sumLeafVolumes(m.customMembers, scale, new Set(ancestors).add(m), depth + 1);
      // A composite that expands to nothing still renders one leaf collider,
      // so charge it as one — mirrors CompositeMemberColliders exactly.
      total += nested || leafVolume(m, scale);
    } else {
      total += leafVolume(m, scale);
    }
  }
  return total;
}

/** One leaf's volume, floored so a degenerate part still gets some mass. */
function leafVolume(m: CustomMember, scale: [number, number, number]): number {
  return Math.max(
    1e-6,
    calculateShapeVolume({ type: m.type, scale, baseSize: m.baseSize }),
  );
}


function composeChildTransform(
  parent: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] },
  child: { offset: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] },
) {
  const parentMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...parent.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...parent.rotation)),
    new THREE.Vector3(...parent.scale),
  );
  const localMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...child.offset),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...child.rotation)),
    new THREE.Vector3(...child.scale),
  );
  const abs = parentMatrix.clone().multiply(localMatrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  abs.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  return {
    position: [position.x, position.y, position.z] as [number, number, number],
    rotation: [euler.x, euler.y, euler.z] as [number, number, number],
    scale: [scale.x, scale.y, scale.z] as [number, number, number],
  };
}

/**
 * Recursively renders a hole-free "custom" composite shape's own members as
 * their own MemberColliders — a nested hole-free "custom" member expands
 * further, a leaf (glb/primitive) member gets voxel-aware treatment exactly
 * like a standalone shape would, rather than the flat getCompoundColliders'
 * per-leaf getShapeColliderConfigs call, which never checked concavity at
 * all and always built a smooth hull for a concave glb leaf (e.g. a gear
 * assembled onto a shaft) — same bug MemberCollider exists to fix, just one
 * level deeper. A nested member that itself HAS structural holes is treated
 * as one leaf (via MemberCollider's own composite-with-holes handling)
 * rather than flattened — flattening would silently drop its hole entirely,
 * since a hole only means something relative to its own siblings.
 */
function CompositeMemberColliders({
  members,
  parentTransform,
  isDynamic,
  evaluator,
  gltfGeometryMap,
  totalLeafMass,
  totalLeafVolume,
  friction,
  restitution,
  keyPrefix,
  ancestors = new Set(),
  depth = 0,
}: {
  members: CustomMember[];
  parentTransform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  isDynamic: boolean;
  evaluator: Evaluator;
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>;
  totalLeafMass: number;
  totalLeafVolume: number;
  friction: number;
  restitution: number;
  keyPrefix: string;
  ancestors?: MemberAncestors;
  depth?: number;
}) {
  const massPerVolume = totalLeafMass / Math.max(1e-9, totalLeafVolume);

  return (
    <>
      {members
        .filter((m) => !m.isHole)
        .map((m, idx) => {
          const childTransform = composeChildTransform(parentTransform, {
            offset: m.offset,
            rotation: m.rotation,
            scale: m.scale,
          });
          const childKey = `${keyPrefix}-${idx}`;
          const childIsCompositeWithHoles =
            m.type === "custom" && !!m.customMembers && hasStructuralHoles(m.customMembers);

          // Stop decomposing on a cycle or past the depth cap and fall through
          // to the single-leaf branch below. Rendering *nothing* here would be
          // worse than rendering one undecomposed collider: the member would
          // silently lose its physics entirely, and countLeaves (which uses
          // the identical condition) would disagree about the mass split.
          const stopDescending = ancestors.has(m) || depth >= MAX_COMPOSITE_DEPTH;
          if (stopDescending && m.type === "custom" && m.customMembers?.length) {
            console.warn(
              `[MemberCollider] stopped decomposing "${keyPrefix}" at depth ${depth}: ` +
                (ancestors.has(m)
                  ? "this member is its own ancestor (cyclic customMembers)."
                  : `exceeded MAX_COMPOSITE_DEPTH (${MAX_COMPOSITE_DEPTH}).`) +
                " Rendering it as a single collider instead.",
            );
          }

          if (
            m.type === "custom" &&
            m.customMembers &&
            m.customMembers.length > 0 &&
            !childIsCompositeWithHoles &&
            !stopDescending
          ) {
            return (
              <CompositeMemberColliders
                key={childKey}
                members={m.customMembers}
                parentTransform={childTransform}
                isDynamic={isDynamic}
                evaluator={evaluator}
                gltfGeometryMap={gltfGeometryMap}
                totalLeafMass={totalLeafMass}
                totalLeafVolume={totalLeafVolume}
                friction={friction}
                restitution={restitution}
                keyPrefix={childKey}
                ancestors={new Set(ancestors).add(m)}
                depth={depth + 1}
              />
            );
          }

          const leafShape: ShapeType = {
            id: -1,
            type: m.type,
            url: m.url,
            baseSize: m.baseSize,
            color: m.color,
            // Dropped when we stopped descending, and only then. MemberCollider
            // starts its own expansion from depth 0 with an empty ancestor set,
            // so handing it the members we just refused to walk would restart
            // the exact recursion the cap exists to stop. A composite that is
            // stopping for the ordinary reason (it has holes) keeps them, since
            // MemberCollider needs them to voxelize it as one unit.
            customMembers: stopDescending ? undefined : m.customMembers,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: childTransform.scale,
          } as ShapeType;

          return (
            <MemberCollider
              key={childKey}
              shape={leafShape}
              position={childTransform.position}
              rotation={childTransform.rotation}
              isDynamic={isDynamic}
              evaluator={evaluator}
              gltfGeometryMap={gltfGeometryMap}
              mass={massPerVolume * leafVolume(m, childTransform.scale)}
              friction={friction}
              restitution={restitution}
              keyPrefix={childKey}
            />
          );
        })}
    </>
  );
}

/**
 * A single group member's collider(s) — used by both a non-boolean group
 * (SimulationScene) and a hole-free/failed-CSG boolean group (CSGGroup's
 * per-solid fallback), i.e. anywhere a member gets its own collider inside
 * a *shared* RigidBody rather than through VoxelizedShapeBody's dedicated
 * one. Mirrors VoxelizedShapeBody's dynamic-and-concave check:
 * - a dynamic glb member with a concave silhouette gets the voxel-compound
 *   path instead of the hull getShapeColliderConfigs would otherwise build;
 * - a dynamic "custom" composite with its own structural hole(s) voxelizes
 *   its whole merged shape as one unit, same reasoning;
 * - a hole-free "custom" composite (just an assembly, e.g. a gear on a
 *   shaft) expands into its own real per-part colliders instead, each of
 *   which gets this same treatment recursively — so a concave leaf inside
 *   an otherwise-ordinary assembly still gets voxelized.
 */
export default function MemberCollider({
  shape,
  position,
  rotation,
  isDynamic,
  evaluator,
  gltfGeometryMap,
  mass,
  friction,
  restitution,
  keyPrefix,
}: MemberColliderProps) {
  const isCompositeCustom =
    shape.type === "custom" && !!shape.customMembers && shape.customMembers.length > 0;
  const compositeHasHoles = isCompositeCustom && hasStructuralHoles(shape.customMembers);

  const needsVoxel =
    isDynamic &&
    ((isCompositeCustom && compositeHasHoles) ||
      (!isCompositeCustom && shape.type === "glb" && shouldVoxelizeShape(shape, gltfGeometryMap)));

  // The CSG fold for a composite-with-holes member now runs off the main
  // thread (lib/useCSGWorker.ts) instead of synchronously inside the
  // useMemo below — see hollowShapeVoxelization.ts's
  // packageCustomShapeVoxelInput doc comment for why that split is safe
  // (the packaging half never needed to move). needsCSGFold gates the
  // dispatch effect so a member that doesn't need voxelization at all never
  // touches the worker.
  const needsCSGFold = needsVoxel && isCompositeCustom;

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

  const { compute: computeCSG, result: csgResult, resolvedKey: csgResolvedKey, error: csgError } = useCSGWorker();

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

  // Not silent (matches the Phase-1 no-empty-catch standard, BUG-046):
  // logged with enough context to find the member. No user-facing event —
  // this pipeline has none today, and VoxelCompoundColliders' existing
  // `fallback` prop (per-part colliders) already covers what a user sees,
  // same as it already does for a voxelization-stage failure.
  useEffect(() => {
    if (!csgError) return;
    console.warn(
      `[MemberCollider] CSG fold failed for member "${keyPrefix}" (shape type "${shape.type}"): ${csgError}`,
    );
  }, [csgError, keyPrefix, shape.type]);

  const voxelInput = useMemo((): VoxelInput | null => {
    if (!needsVoxel) return null;
    if (isCompositeCustom) {
      // isCSGResultCurrent rejects a stale result left over from before
      // shape.customMembers changed — see voxelInputGate.ts's doc comment
      // for why packaging it anyway would poison useVoxelCollider's cache
      // under the NEW cacheKey with the OLD geometry.
      if (!isCSGResultCurrent(csgResolvedKey, csgDepsKey, csgResult?.positions.length)) return null;
      return packageCustomShapeVoxelInput(shape, csgResult!.positions, csgResult!.indices);
    }
    if (shape.type === "glb" && gltfGeometryMap) return buildGlbShapeVoxelInput(shape, gltfGeometryMap);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    needsVoxel,
    isCompositeCustom,
    csgResolvedKey,
    csgDepsKey,
    csgResult,
    shape.type,
    shape.scale.join(","),
    shape.url,
    // See VoxelizedShapeBody: JSON.stringify throws on a cyclic member tree
    // and re-walks the tree every render; serializeMembers does neither.
    serializeMembers(shape.customMembers),
    gltfGeometryMap,
  ]);

  // Hole-free composite: no voxelization at this level, just expand into
  // real per-part colliders (each independently voxel-aware).
  if (isCompositeCustom && !compositeHasHoles) {
    const totalLeafVolume = sumLeafVolumes(shape.customMembers, shape.scale);
    return (
      <CompositeMemberColliders
        members={shape.customMembers!}
        parentTransform={{ position, rotation, scale: shape.scale }}
        isDynamic={isDynamic}
        evaluator={evaluator}
        gltfGeometryMap={gltfGeometryMap}
        totalLeafMass={mass}
        totalLeafVolume={totalLeafVolume}
        friction={friction}
        restitution={restitution}
        keyPrefix={keyPrefix}
      />
    );
  }

  const fallback = isCompositeCustom ? (
    // Composite-with-holes fallback while its whole-unit voxelization is
    // still resolving: the same per-part expansion as the hole-free case
    // above (unaware of the hole, same accepted transient as CSGGroup's
    // equivalent fallback) rather than nothing at all.
    <CompositeMemberColliders
      members={shape.customMembers!}
      parentTransform={{ position, rotation, scale: shape.scale }}
      isDynamic={isDynamic}
      evaluator={evaluator}
      gltfGeometryMap={gltfGeometryMap}
      totalLeafMass={mass}
      totalLeafVolume={sumLeafVolumes(shape.customMembers, shape.scale)}
      friction={friction}
      restitution={restitution}
      keyPrefix={`${keyPrefix}-fallback`}
    />
  ) : (
    (() => {
      const colConfs = getShapeColliderConfigs(shape, gltfGeometryMap, isDynamic);
      return (
        <>
          {colConfs.map((conf, idx) => (
            <PrimitiveCollider
              key={`${keyPrefix}-${idx}`}
              col={{ type: conf.type, args: conf.args, position, rotation }}
              mass={mass * (conf.massFraction ?? 1 / colConfs.length)}
              friction={friction}
              restitution={restitution}
            />
          ))}
        </>
      );
    })()
  );

  if (!needsVoxel) return fallback;

  return (
    <VoxelCompoundColliders
      voxelInput={voxelInput}
      mass={mass}
      friction={friction}
      restitution={restitution}
      keyPrefix={keyPrefix}
      fallback={fallback}
      parentPosition={position}
      parentRotation={rotation}
    />
  );
}
