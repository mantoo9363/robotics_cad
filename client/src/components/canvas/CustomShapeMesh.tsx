import React, { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import { Evaluator } from "three-bvh-csg";
import type { ShapeType } from "../../App";
import type { CircuitStreamFrame } from "../../lib/circuitStream";
import ShapeMaterial from "./ShapeMaterial";
import type { WorkspaceSettings } from "../../types/workspace";
import { useCSGWorker, extractGlbArrays } from "../../lib/useCSGWorker";
import { arraysToGeometry } from "../../lib/csgEvaluation";
import { StaleGeometryHold } from "../../lib/staleGeometryHold";
import { serializeCustomMembers, collectGlbUrlsFromCustomMembers } from "./utils/csgKeys";
import type { GlbGeometryArrays } from "../../lib/workerGlbRegistry";
import "../../lib/csgProbe";

type CustomShapeMeshProps = {
  shape: ShapeType;
  evaluator: Evaluator;
  simulationFrame?: CircuitStreamFrame | null;
  isSelected?: boolean;
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>;
  onLoaded?: (baseSize: [number, number, number]) => void;
  wsSettings?: WorkspaceSettings;
  [key: string]: any;
};

const CustomShapeMesh = React.forwardRef<THREE.Mesh, CustomShapeMeshProps>(
  (
    {
      shape,
      // Destructured out (not passed through `...meshProps` to the native
      // <mesh>) but no longer read: the worker owns its own Evaluator
      // instance now (see csgEvaluation.ts), so this component no longer
      // needs the caller's shared one. Kept as an accepted prop so callers
      // (CSGGroup.tsx's fallback branch, KinematicNode.tsx) don't need
      // changes just because this component stopped needing it.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      evaluator,
      simulationFrame = null,
      isSelected,
      gltfGeometryMap,
      onLoaded,
      wsSettings,
      ...meshProps
    },
    ref,
  ) => {
    const hasMembers = !!shape.customMembers && shape.customMembers.length > 0;

    const depsKey = useMemo(
      () => `${serializeCustomMembers(shape.customMembers)}|color:${shape.color || ""}`,
      [shape.customMembers, shape.color],
    );

    const neededGlbUrls = useMemo(
      () => collectGlbUrlsFromCustomMembers(shape.customMembers),
      [shape.customMembers],
    );

    // Flattened once per distinct GLB actually in the scene — same reasoning
    // as CSGGroup.tsx's allGlbArrays: gltfGeometryMap's identity only
    // changes when the scene's GLB set changes, not on every recompute.
    const allGlbArrays = useMemo(() => {
      const map = new Map<string, GlbGeometryArrays>();
      gltfGeometryMap?.forEach((geom: THREE.BufferGeometry, url: string) => map.set(url, extractGlbArrays(geom)));
      return map;
    }, [gltfGeometryMap]);

    const { compute, result, resolvedKey, error, droppedCount, evalElapsedMs } = useCSGWorker();

    useEffect(() => {
      if (!hasMembers) return;
      const filtered = new Map<string, GlbGeometryArrays>();
      neededGlbUrls.forEach((url) => {
        const arrays = allGlbArrays.get(url);
        if (arrays) filtered.set(url, arrays);
      });
      compute(
        depsKey,
        { kind: "members", members: shape.customMembers!, fallbackColor: shape.color },
        filtered,
      );
    }, [hasMembers, depsKey, shape.customMembers, shape.color, neededGlbUrls, allGlbArrays, compute]);

    // Every failure path routes into the same csg-error CustomEvent
    // CSGGroup.tsx uses, not a new channel — worker init failure, worker
    // crash, or evaluateCustomGeometry throwing (its own degenerate-hole
    // retry exhausted, or a malformed member tree).
    useEffect(() => {
      if (!error) return;
      console.warn("CustomShape CSG error", error);
      window.dispatchEvent(new CustomEvent("csg-error", { detail: `CSG error: ${error}` }));
    }, [error]);

    // A resolved-but-empty result (0 positions) is distinct from a worker
    // error: evaluateCustomGeometry can legitimately produce one (a hole
    // subtraction that consumes the whole solid) without throwing. Warned
    // about the same way the pre-worker version did, once per distinct
    // occurrence (this effect only re-fires when `result`'s reference
    // changes to a new resolved value, not on every render).
    useEffect(() => {
      if (!result || result.positions.length !== 0) return;
      window.dispatchEvent(
        new CustomEvent("csg-error", {
          detail: "Warning: CustomShape has 0 positions (empty shape).",
        }),
      );
    }, [result]);

    const resultGeometry = useMemo(() => {
      if (!result || result.positions.length === 0) return null;
      return arraysToGeometry(result);
    }, [result]);

    // Stale-mesh fallback: keep showing the last successfully resolved
    // geometry while a new one is pending, rather than CSGGroup.tsx's
    // "fall back to ungrouped members" (not available here — this
    // component's "members" are the whole shape, there's nothing else to
    // render instead). See StaleGeometryHold's own doc comment for the
    // swap/dispose ordering guarantee.
    //
    // useState's lazy initializer, not a ref lazily set during render: the
    // instance still only gets constructed once and stays referentially
    // stable across re-renders, but doesn't read/write a ref's `.current`
    // outside an effect (react-hooks/refs — this component already had
    // three pre-existing violations of that rule before this change, from
    // the old prevGeomValidRef pattern this rewrite removes; no reason to
    // add a fourth).
    const [hold] = useState(() => new StaleGeometryHold());
    const [displayGeometry, setDisplayGeometry] = useState<THREE.BufferGeometry | null>(null);

    useEffect(() => {
      setDisplayGeometry(hold.update(resultGeometry));
    }, [resultGeometry, hold]);

    useEffect(() => {
      return () => hold.disposeAll();
    }, [hold]);

    const innerRef = useRef<THREE.Mesh>(null);
    const mergedRef = (el: THREE.Mesh | null) => {
      (innerRef as React.MutableRefObject<THREE.Mesh | null>).current = el;
      if (typeof ref === "function") ref(el);
      else if (ref)
        (ref as React.MutableRefObject<THREE.Mesh | null>).current = el;
    };

    useEffect(() => {
      if (innerRef.current && displayGeometry) {
        innerRef.current.geometry = displayGeometry;
      }
    }, [displayGeometry]);

    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;
    const reportedRef = useRef(false);

    // Reset per shape identity (a new customMembers tree), not per
    // recompute — a stale-held geometry re-reporting its already-reported
    // size on every superseding request would be redundant, not wrong, but
    // this matches the original's "once per shape" intent more closely.
    useEffect(() => {
      reportedRef.current = false;
    }, [shape.customMembers]);

    useEffect(() => {
      if (!reportedRef.current && onLoadedRef.current && displayGeometry) {
        if (!displayGeometry.boundingBox) displayGeometry.computeBoundingBox();
        const box = displayGeometry.boundingBox;
        if (!box) return;
        reportedRef.current = true;
        const size = new THREE.Vector3();
        box.getSize(size);
        if (size.x === 0 && size.y === 0 && size.z === 0) {
          onLoadedRef.current([1, 1, 1]);
        } else {
          onLoadedRef.current([size.x, size.y, size.z]);
        }
      }
    }, [displayGeometry]);

    // DEV-only telemetry, same shape/convention as CSGGroup.tsx's
    // window.__csgProbe — keyed by shape id since a CustomShapeMesh
    // instance corresponds to exactly one shape, not a group.
    useEffect(() => {
      if (!(process.env.NODE_ENV !== "production")) return;
      if (!window.__csgProbe) window.__csgProbe = {};
      window.__csgProbe[String(shape.id)] = {
        lastRequestAt: null,
        lastResolveAt: result || error ? performance.now() : null,
        usingFallback: !displayGeometry,
        droppedCount: droppedCount(),
        currentComputeKey: depsKey,
        resolvedKey,
        evalElapsedMs: evalElapsedMs ?? undefined,
        // CustomShapeMesh-specific: whether what's currently displayed is a
        // stale (superseded) result rather than the freshest resolved one —
        // CSGGroup.tsx has no equivalent field since it has no stale-hold.
        isStale: displayGeometry !== null && resultGeometry !== displayGeometry,
      };
    });

    if (!displayGeometry) return null;
    return (
      <mesh
        ref={mergedRef}
        {...meshProps}
        castShadow={meshProps.castShadow !== undefined ? meshProps.castShadow : !shape.isHole}
        receiveShadow={meshProps.receiveShadow !== undefined ? meshProps.receiveShadow : !shape.isHole}
      >
        <primitive object={displayGeometry} attach="geometry" />
        <ShapeMaterial shape={shape} simulationData={simulationFrame} />
        {isSelected && (
          <Edges color={shape.isLocked ? "#f43f5e" : "#4361ee"} />
        )}
      </mesh>
    );
  },
);

CustomShapeMesh.displayName = "CustomShapeMesh";

export default CustomShapeMesh;
