import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import { Evaluator } from "three-bvh-csg";
import { TrimeshCollider, ConvexHullCollider } from "@react-three/rapier";
import type { ShapeType } from "../../App";
import type { CircuitStreamFrame } from "../../lib/circuitStream";
import { getShapeCircuitMaterial } from "../../lib/circuitStream";
import CustomShapeMesh from "./CustomShapeMesh";
import { SuspendedGlbShapeMesh } from "./GlbShapeMesh";
import PrimitiveGeometry from "./PrimitiveGeometry";
import ShapeMaterial from "./ShapeMaterial";
import VoxelCompoundColliders from "./VoxelCompoundColliders";
import MemberCollider from "./MemberCollider";
import { resolveShapeMass } from "../../lib/physicsUtils";
import { getCachedGeometry } from "../../lib/geometryCache";
import type { VoxelInput } from "../../lib/hollowShapeVoxelization";
import type { FeatureRegion } from "../../lib/voxelCollider";
import { useCSGWorker, extractGlbArrays } from "../../lib/useCSGWorker";
import { arraysToGeometry } from "../../lib/csgEvaluation";
import type { GlbGeometryArrays } from "../../lib/workerGlbRegistry";
import { collectGlbUrls, serializeCustomMembers } from "./utils/csgKeys";
import "../../lib/csgProbe";

type CSGGroupProps = {
  members: ShapeType[];
  selectedIds: number[];
  evaluator: Evaluator;
  onPointerDown: (e: any, members: ShapeType[]) => void;
  isPhysics?: boolean;
  isStatic?: boolean;
  anchor?: [number, number, number];
  anchorRotation?: [number, number, number];
  simulationFrame: CircuitStreamFrame | null;
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>;
  meshRefs?: React.MutableRefObject<Map<number, THREE.Object3D>>;
  updateBaseSize?: (id: number, baseSize: [number, number, number]) => void;
  edgesColor?: string;
  friction?: number;
  restitution?: number;
};

export default React.memo(function CSGGroup({
  members,
  selectedIds,
  evaluator,
  onPointerDown,
  isPhysics,
  isStatic,
  anchor,
  anchorRotation,
  simulationFrame,
  gltfGeometryMap,
  meshRefs,
  updateBaseSize,
  edgesColor,
  friction,
  restitution,
}: CSGGroupProps) {
  // Memoized so they keep a stable identity across renders. As plain
  // per-render `.filter()` calls these produced a new array every time, which
  // cascaded: holeFeatureRegions depends on `holes`, csgVoxelInput depends on
  // that, so the ENTIRE CSG mesh's position and index buffers were copied into
  // fresh typed arrays on every single render of every CSG group in the
  // simulation. compute() no-ops on the unchanged key, so it was pure waste
  // rather than wrong output — but it was proportional to mesh size and ran
  // every frame a parent re-rendered. See BUG-015.
  const solids = useMemo(() => members.filter((s: ShapeType) => !s.isHole), [members]);
  const holes = useMemo(() => members.filter((s: ShapeType) => s.isHole), [members]);
  const isSelected = members.some((s: ShapeType) => selectedIds.includes(s.id));

  // Local (anchor-relative) position/rotation for a solid member — mirrors the
  // transform used to place its brush inside the merged CSG mesh, so a
  // per-member collider lines up with that member's actual visual position.
  const getLocalTransform = (s: ShapeType) => {
    let pos = s.position;
    let rot = s.rotation;
    if (anchor) {
      const qParent = anchorRotation
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...anchorRotation))
        : new THREE.Quaternion();
      const qChild = new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation));
      const qParentInv = qParent.clone().invert();

      const qLocal = qParentInv.clone().multiply(qChild);
      const eulerLocal = new THREE.Euler().setFromQuaternion(qLocal);
      rot = [eulerLocal.x, eulerLocal.y, eulerLocal.z];

      const posDiff = new THREE.Vector3(
        s.position[0] - anchor[0],
        s.position[1] - anchor[1],
        s.position[2] - anchor[2],
      );
      const posLocalVec = posDiff.applyQuaternion(qParentInv);
      pos = [posLocalVec.x, posLocalVec.y, posLocalVec.z];
    }
    return { position: pos, rotation: rot };
  };

  // Per-member colliders for a dynamic CSG group — rendered via
  // MemberCollider (one per solid) instead of a single ConvexHullCollider
  // around the whole merged/cut mesh, which would round off every gap and
  // hole between blocks and make the whole group behave like a smooth blob
  // rather than the actual assembled shape. MemberCollider itself decides
  // per-member whether a plain hull/cuboid is good enough or the shape
  // (a concave glb import, or a composite "custom" sub-assembly with its
  // own structural hole) needs the voxel-compound path.
  const solidMemberColliders = isPhysics
    ? solids
        .filter((s) => !s.collisionDisabled)
        .map((s) => {
          const { position, rotation } = getLocalTransform(s);
          const memberMass = resolveShapeMass(s);
          return (
            <MemberCollider
              key={`csg-member-${s.id}`}
              shape={s}
              position={position}
              rotation={rotation}
              isDynamic={!isStatic}
              evaluator={evaluator}
              gltfGeometryMap={gltfGeometryMap}
              mass={memberMass}
              friction={friction ?? 0.6}
              restitution={restitution ?? 0.2}
              keyPrefix={`csg-member-${s.id}`}
            />
          );
        })
    : [];

  // Total real mass of the group (holes carry none) — how the voxel boxes'
  // per-box mass fraction below is scaled.
  const groupMass = useMemo(() => {
    return (
      solids
        .filter((s) => !s.collisionDisabled)
        .reduce((sum, s) => sum + resolveShapeMass(s), 0) || 1
    );
  }, [solids]);

  // Local-space (anchor-relative) bounding box of each hole member — the
  // voxelizer's known-feature-region hint, same role collectHoleRegions
  // plays for a "custom" shape's own CSG holes. Without this the fine grid
  // that resolves a hole falls back to the coarse whole-group grid, which
  // can miss a hole that's small relative to the group.
  const holeFeatureRegions = useMemo((): FeatureRegion[] => {
    return holes.map((h) => {
      const { position, rotation } = getLocalTransform(h);
      const geom =
        h.type === "custom" || h.type === "glb"
          ? new THREE.BoxGeometry(1, 1, 1)
          : getCachedGeometry(h.type, "low").clone();
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(...h.scale),
      );
      geom.applyMatrix4(matrix);
      geom.computeBoundingBox();
      const b = geom.boundingBox!;
      return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holes, anchor, anchorRotation]);

  const depsKey = useMemo(() => {
    return members
      .map(
        (s) =>
          `${s.id}-${s.type}-${s.url || ""}-${s.position.join(
            ",",
          )}-${s.rotation.join(",")}-${s.scale.join(",")}-${
            s.color || ""
          }-${s.isHole}-${serializeCustomMembers(s.customMembers)}`,
      )
      .join("|");
  }, [members]);

  // The extended key a worker request is identified by — depsKey alone
  // (members' own fields) is what the old synchronous useMemo's cache
  // relied on React to track independently per-dependency, but a worker
  // request's cache key must fully capture everything the computation
  // reads. anchor/anchorRotation/isPhysics all feed evaluateCSGGroupGeometry
  // (the anchor-relative transform branch), so they belong in the key, not
  // just in a `useEffect`'s dependency array — a request cache keyed on
  // depsKey alone would wrongly reuse a stale result if only the anchor
  // changed (e.g. a joint-driven CSG group mid-animation).
  const computeKey = useMemo(
    () =>
      `${depsKey}|anchor:${anchor?.join(",") ?? ""}|arot:${anchorRotation?.join(",") ?? ""}|phys:${isPhysics}`,
    [depsKey, anchor, anchorRotation, isPhysics],
  );

  const neededGlbUrls = useMemo(() => collectGlbUrls(members), [members]);

  // Flattened once per distinct GLB actually in the scene (gltfGeometryMap's
  // identity only changes when the scene's GLB set changes, not on every
  // drag frame) — extractGlbArrays() copies out of the live geometry
  // without re-normalizing it. Filtered down to what this group's members
  // actually reference before being sent to the worker, so a group with no
  // GLB members never touches this at all, and registration traffic stays
  // proportional to real usage rather than the whole scene's GLB set.
  const allGlbArrays = useMemo(() => {
    const map = new Map<string, GlbGeometryArrays>();
    gltfGeometryMap?.forEach((geom, url) => map.set(url, extractGlbArrays(geom)));
    return map;
  }, [gltfGeometryMap]);

  const { compute, result, resolvedKey, error, droppedCount, evalElapsedMs } = useCSGWorker();

  const groupProbeKey = useMemo(() => String(members[0]?.id ?? "unknown"), [members]);
  const lastRequestAtRef = React.useRef<number | null>(null);

  useEffect(() => {
    const filtered = new Map<string, GlbGeometryArrays>();
    neededGlbUrls.forEach((url) => {
      const arrays = allGlbArrays.get(url);
      if (arrays) filtered.set(url, arrays);
    });
    lastRequestAtRef.current = performance.now();
    compute(computeKey, { kind: "group", members, isPhysics, anchor, anchorRotation }, filtered);
  }, [computeKey, members, isPhysics, anchor, anchorRotation, neededGlbUrls, allGlbArrays, compute]);

  // Every failure path — worker init failure, worker crash, a genuine
  // degenerate result (evaluateCSGGroupGeometry throws for that case, see
  // geometryHelpers.ts) — surfaces as `error` from the hook. Routed into the
  // same csg-error CustomEvent the synchronous path used to dispatch
  // directly from its catch block, so nothing downstream needs to know this
  // moved off the main thread.
  useEffect(() => {
    if (!error) return;
    console.warn("CSG Error", error);
    window.dispatchEvent(
      new CustomEvent("csg-error", { detail: `CSGGroup error: ${error}` }),
    );
  }, [error]);

  // Rebuilt fresh from the worker's arrays whenever `result` changes.
  // `result` is null both while a request is pending and after a failure
  // (see useCSGWorker.ts) — resultGeometry collapses both, plus the
  // legitimate "not applicable" empty-arrays case, into the same "nothing
  // to render yet" null the render logic below already knows how to fall
  // back from.
  const resultGeometry = useMemo(() => {
    if (!result || result.positions.length === 0) return null;
    return arraysToGeometry(result);
  }, [result]);

  useEffect(() => {
    return () => {
      resultGeometry?.dispose();
    };
  }, [resultGeometry]);

  // DEV-only telemetry, stripped from production builds by
  // (process.env.NODE_ENV !== "production"), same convention as SimulationScene.tsx's
  // window.__vehicleProbe.
  useEffect(() => {
    if (!(process.env.NODE_ENV !== "production")) return;
    if (!window.__csgProbe) window.__csgProbe = {};
    window.__csgProbe[groupProbeKey] = {
      lastRequestAt: lastRequestAtRef.current,
      lastResolveAt: result || error ? performance.now() : null,
      usingFallback: !holes.length || !resultGeometry,
      droppedCount: droppedCount(),
      currentComputeKey: computeKey,
      resolvedKey,
      evalElapsedMs: evalElapsedMs ?? undefined,
    };
  });

  // Voxel-compound input for the dynamic case: the CSG group's real,
  // already-holed result geometry, not a per-solid-member approximation
  // that has no idea a hole was ever subtracted from it — solidMemberColliders
  // above builds exactly that unaware approximation (correct per-member, but
  // blind to the group-level subtraction), and remains this component's
  // fallback for while the worker hasn't resolved yet or for static bodies
  // (which use the exact TrimeshCollider instead, see the render below).
  const csgVoxelInput = useMemo((): VoxelInput | null => {
    if (!isPhysics || isStatic || !resultGeometry) return null;
    if (!resultGeometry.attributes.position || resultGeometry.attributes.position.count === 0) {
      return null;
    }
    const positions = new Float32Array(resultGeometry.attributes.position.array);
    const indices = resultGeometry.index ? new Uint32Array(resultGeometry.index.array) : undefined;
    return { positions, indices, featureRegions: holeFeatureRegions, cacheKey: `csg-${depsKey}` };
  }, [isPhysics, isStatic, resultGeometry, holeFeatureRegions, depsKey]);

  const handleDown = (e: any) => {
    e.stopPropagation();
    onPointerDown(e, members);
  };

  const handleIndividualShapeDown = (e: any, shape: ShapeType) => {
    e.stopPropagation();
    onPointerDown(e, [shape]);
  };

  const createShapeHandler = (shape: ShapeType) => (e: any) => {
    handleIndividualShapeDown(e, shape);
  };

  if (!holes.length || !resultGeometry) {
    return (
      <>
        {members.map((shape: ShapeType) => {
          const isSelected = selectedIds.includes(shape.id);
          let pos = shape.position;
          let rot = shape.rotation;
          if (isPhysics && anchor) {
            const qParent = anchorRotation
              ? new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(...anchorRotation),
                )
              : new THREE.Quaternion();
            const qChild = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(...shape.rotation),
            );
            const qParentInv = qParent.clone().invert();

            const qLocal = qParentInv.clone().multiply(qChild);
            const eulerLocal = new THREE.Euler().setFromQuaternion(qLocal);
            rot = [eulerLocal.x, eulerLocal.y, eulerLocal.z];

            const posDiff = new THREE.Vector3(
              shape.position[0] - anchor[0],
              shape.position[1] - anchor[1],
              shape.position[2] - anchor[2],
            );
            const posLocalVec = posDiff.applyQuaternion(qParentInv);
            pos = [posLocalVec.x, posLocalVec.y, posLocalVec.z];
          }

          if (shape.type === "custom" && shape.customMembers) {
            return (
              <CustomShapeMesh
                key={shape.id}
                ref={(el) => {
                  if (el && meshRefs) {
                    meshRefs.current.set(shape.id, el);
                  }
                }}
                position={pos}
                rotation={rot}
                scale={shape.scale}
                onPointerDown={createShapeHandler(shape)}
                shape={shape}
                evaluator={evaluator}
                simulationFrame={simulationFrame}
                isSelected={isSelected}
                gltfGeometryMap={gltfGeometryMap}
                userData={{ shapeId: shape.id }}
                onLoaded={(baseSize: [number, number, number]) =>
                  updateBaseSize?.(shape.id, baseSize)
                }
                castShadow={!shape.isHole}
                receiveShadow={!shape.isHole}
              />
            );
          }

          if (shape.type === "glb" && shape.url) {
            return (
              <SuspendedGlbShapeMesh
                key={shape.id}
                ref={(el) => {
                  if (el && meshRefs) {
                    meshRefs.current.set(shape.id, el);
                  }
                }}
                position={pos}
                rotation={rot}
                scale={shape.scale}
                onPointerDown={createShapeHandler(shape)}
                shape={shape}
                simulationFrame={simulationFrame}
                isSelected={isSelected}
                userData={{ shapeId: shape.id }}
                onLoaded={(baseSize: [number, number, number]) =>
                  updateBaseSize?.(shape.id, baseSize)
                }
                castShadow={!shape.isHole}
                receiveShadow={!shape.isHole}
              />
            );
          }

          return (
            <mesh
              key={shape.id}
              ref={(el) => {
                if (el && meshRefs) {
                  meshRefs.current.set(shape.id, el);
                }
              }}
              position={pos}
              rotation={rot}
              scale={shape.scale}
              onPointerDown={createShapeHandler(shape)}
              userData={{ shapeId: shape.id }}
              castShadow={!shape.isHole}
              receiveShadow={!shape.isHole}
            >
              <PrimitiveGeometry type={shape.type} />
              {(() => {
                const sim = shape.isHole ? null : simulationFrame;
                return (
                  <ShapeMaterial
                    shape={shape}
                    simulationData={sim}
                    side={THREE.DoubleSide}
                  />
                );
              })()}
              {isSelected && (
                <Edges
                  color={shape?.isLocked ? "#f43f5e" : edgesColor || "#4361ee"}
                />
              )}
            </mesh>
          );
        })}
        {isPhysics && solidMemberColliders}
      </>
    );
  }

  const mergedSim = solids.reduce(
    (best: { emissive: string; emissiveIntensity: number }, s: ShapeType) => {
      const cur = getShapeCircuitMaterial(s, simulationFrame ?? null);
      return cur.emissiveIntensity > best.emissiveIntensity ? cur : best;
    },
    { emissive: "#000000", emissiveIntensity: 0 },
  );

  // Geometry is set via <primitive object={resultGeometry} attach="geometry" /> below.
  // No need for a separate useEffect — R3F handles the attach synchronously.

  const isMultiColorOrCustom = solids.some(
    (s) => s.type === "custom" || s.color !== solids[0]?.color,
  );

  const resultMeshElement = (
    <mesh
      onPointerDown={handleDown}
      userData={{ shapeId: solids[0]?.id, isCSGMesh: true }}
      castShadow
      receiveShadow
    >
      <primitive object={resultGeometry} attach="geometry" />
      <ShapeMaterial
        shape={
          isMultiColorOrCustom
            ? {
                ...(solids[0] || members[0]),
                type: "custom",
                color: "#ffffff",
              }
            : solids[0] || members[0]
        }
        simulationData={mergedSim}
      />
      {isSelected && <Edges color={edgesColor || "#4361ee"} />}
    </mesh>
  );

  // three-bvh-csg results carry sliver triangles along every boolean seam.
  // Rapier cooks a Trimesh collider synchronously in WASM on the main thread,
  // and that cook degrades badly — to the point of freezing the tab
  // indefinitely — once the mesh gets into the hundreds of thousands of
  // triangles a complex holed assembly produces. Past this cap, approximate a
  // STATIC group with a convex hull instead: the hull cost is bounded by its
  // own vertex count, and for fixed geometry losing the hole in the collider
  // is acceptable (nothing falls through a static body).
  const CSG_TRIMESH_TRI_CAP = 50000;
  const resultTriCount = resultGeometry
    ? (resultGeometry.index
        ? resultGeometry.index.count
        : resultGeometry.attributes.position.count) / 3
    : 0;
  const trimeshTooHeavy = resultTriCount > CSG_TRIMESH_TRI_CAP;
  if ((process.env.NODE_ENV !== "production") && isPhysics && isStatic && trimeshTooHeavy) {
    console.warn(
      `[CSGGroup] result mesh has ${Math.round(resultTriCount)} triangles ` +
        `(> ${CSG_TRIMESH_TRI_CAP}); using a convex-hull collider instead of a ` +
        `Trimesh to avoid a Rapier cook freeze. The hole is not represented in ` +
        `the collider.`,
    );
  }

  return (
    <>
      {resultMeshElement}
      {isPhysics && resultGeometry ? (
        isStatic && resultGeometry.index && !trimeshTooHeavy ? (
          <TrimeshCollider
            args={[
              resultGeometry.attributes.position.array,
              resultGeometry.index.array,
            ]}
            // Was the only collider in this file that took neither, so a
            // locked CSG group silently used Rapier's defaults instead of the
            // group's authored surface properties. See BUG-023.
            friction={friction ?? 0.6}
            restitution={restitution ?? 0.2}
          />
        ) : isStatic && trimeshTooHeavy ? (
          <ConvexHullCollider
            args={[resultGeometry.attributes.position.array]}
            friction={friction ?? 0.6}
            restitution={restitution ?? 0.2}
          />
        ) : (
          <VoxelCompoundColliders
            voxelInput={csgVoxelInput}
            mass={groupMass}
            friction={friction ?? 0.6}
            restitution={restitution ?? 0.2}
            keyPrefix={`csg-${depsKey}`}
            fallback={
              <>{solidMemberColliders}</>
            }
          />
        )
      ) : null}
    </>
  );
});
