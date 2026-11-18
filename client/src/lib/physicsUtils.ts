import * as THREE from "three";
import { getCachedGeometry } from "./geometryCache";
import {
  COGWHEEL_INNER_RADIUS,
  COGWHEEL_OUTER_RADIUS,
  COGWHEEL_BORE_RADIUS,
  COGWHEEL_DEPTH,
  COGWHEEL_BEVEL_SIZE,
  COGWHEEL_BEVEL_THICKNESS,
  getCogwheelToothProfile,
} from "../components/canvas/utils/geometryHelpers";

// Unit-scale volume of a cogwheel: the sum of its base-ring and tooth wedges,
// which is exactly the material getCogwheelCompoundColliders emits colliders
// for. Cached per tooth-count — the profile is fixed geometry, so this is a
// constant per type. Defined above calculateShapeVolume because it is used
// there; the wedge maths itself lives with the collider builder further down.
const cogwheelUnitVolumeCache = new Map<string, number>();
function cogwheelUnitVolume(type: string): number {
  const hit = cogwheelUnitVolumeCache.get(type);
  if (hit !== undefined) return hit;
  const teeth = COGWHEEL_TEETH_BY_TYPE[type] ?? 8;
  const angleStep = (2 * Math.PI) / teeth;
  let total = 0;
  for (let i = 0; i < teeth; i++) {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = getCogwheelToothProfile(teeth, i);
    const a = i * angleStep;
    const b = a + angleStep;
    total += shoelaceArea([
      [Math.cos(a) * COGWHEEL_BORE_RADIUS, Math.sin(a) * COGWHEEL_BORE_RADIUS],
      [Math.cos(a) * COGWHEEL_INNER_RADIUS, Math.sin(a) * COGWHEEL_INNER_RADIUS],
      [Math.cos(b) * COGWHEEL_INNER_RADIUS, Math.sin(b) * COGWHEEL_INNER_RADIUS],
      [Math.cos(b) * COGWHEEL_BORE_RADIUS, Math.sin(b) * COGWHEEL_BORE_RADIUS],
    ]) * COGWHEEL_DEPTH;
    total += shoelaceArea([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) * COGWHEEL_DEPTH;
  }
  cogwheelUnitVolumeCache.set(type, total);
  return total;
}

/**
 * Calculates the volume of a given shape based on its type and scale.
 */
export function calculateShapeVolume(shape: { type: string; scale: [number, number, number]; baseSize?: [number, number, number] }): number {
  const { type, scale } = shape;
  
  switch (type) {
    case "cube":
    case "hexagon":
      return scale[0] * scale[1] * scale[2];
    
    case "sphere": {
      const radius = scale[0] / 2;
      return (4 / 3) * Math.PI * Math.pow(radius, 3);
    }
    
    case "cylinder": {
      const cylRadius = scale[0] / 2;
      return Math.PI * Math.pow(cylRadius, 2) * scale[1];
    }
    
    case "cone": {
      const coneRadius = scale[0] / 2;
      return (1 / 3) * Math.PI * Math.pow(coneRadius, 2) * scale[1];
    }
    
    case "torus": {
      const majorRadius = scale[0] / 2;
      const minorRadius = scale[1] / 2;
      // 2*pi^2 * R * r^2. The previous expression squared the wrong radius —
      // 2*pi*R^2 * pi*r — which is dimensionally still a volume, so it looked
      // plausible while being wrong by a factor of exactly R/r. At the app's
      // own default torus proportions that is 2.67x too heavy. See BUG-018.
      return 2 * Math.PI * Math.PI * majorRadius * Math.pow(minorRadius, 2);
    }
    
    case "cogwheel":
    case "cogwheel-6t":
    case "cogwheel-8t":
    case "cogwheel-12t":
    case "cogwheel-16t": {
      // A gear is not a solid cylinder: it has an axle bore through the middle
      // and roughly a fifth of each angular step is empty tooth gap. Treating
      // it as one over-estimated default mass by about a third. The exact
      // per-wedge areas are already derived from the real tooth profile in
      // getCogwheelCompoundColliders, so reuse those rather than keeping a
      // second, driftable approximation here. See BUG-022.
      return cogwheelUnitVolume(type) * scale[0] * scale[1] * scale[2];
    }
    
    case "group":
    case "custom":
      return scale[0] * scale[1] * scale[2] * 0.5; // Bounding box approximation
    
    case "glb": {
      const base = shape.baseSize || [1, 1, 1];
      const w = scale[0] * base[0];
      const h = scale[1] * base[1];
      const d = scale[2] * base[2];
      return w * h * d * 0.4; // Typical density fill factor for 3D meshes
    }
    
    default:
      return scale[0] * scale[1] * scale[2];
  }
}

/**
 * Estimates shape mass (kg) based on volume and density (default: 1000 kg/m^3).
 */
export function calculateShapeMass(shape: { type: string; scale: [number, number, number]; baseSize?: [number, number, number] }, density: number = 1000): number {
  const volume = calculateShapeVolume(shape);
  // Volume is in generic units, assume 1 unit = 1 meter or map to standard mass
  return Math.max(0.01, volume * (density / 1000));
}

// A user-entered mass has no upper bound in the Inspector's number input
// (min="0.001" only) — a fat-fingered or pasted value (seen in the wild:
// 121212123) reaches Rapier as-is. Physically that's not a bug in the
// engine: a body outweighing everything around it by 7+ orders of
// magnitude genuinely will fling anything it contacts on any collision,
// since impulse transfer scales with the colliding bodies' relative mass.
// This ceiling is a sanity backstop, not a real-world limit — generous
// enough for legitimate heavy parts at this app's CAD scale, tight enough
// that a typo can't turn a contact into an explosion.
export const MAX_SHAPE_MASS = 100_000;

/** Resolves a shape's effective mass for physics: its own authored value if
 * set (clamped to a sane ceiling — see MAX_SHAPE_MASS), otherwise the
 * volume-based default. Every RigidBody/collider mass in this app should
 * route through this rather than reading `shape.mass` directly, so a bad
 * already-saved value can't silently reach Rapier even if the Inspector's
 * own input-side clamp is bypassed (older saved state, hand-edited JSON). */
export function resolveShapeMass(shape: { type: string; scale: [number, number, number]; baseSize?: [number, number, number]; mass?: number }): number {
  if (shape.mass !== undefined) {
    return Math.min(MAX_SHAPE_MASS, Math.max(0.001, shape.mass));
  }
  return calculateShapeMass(shape);
}

export type ColliderConfig = {
  type: "cuboid" | "ball" | "cylinder" | "cone" | "trimesh" | "hull";
  args: any;
  position?: [number, number, number];
  rotation?: [number, number, number];
  // Present on compound-decomposition pieces (gear teeth, torus wedges)
  // whose sub-parts have different volumes. Callers should scale the whole
  // shape's mass by this fraction instead of splitting evenly across all
  // pieces, so total mass still equals the shape's mass but center-of-mass
  // stays close to a solid part.
  massFraction?: number;
};

/**
 * Helper to safely extract index array for buffer geometr`ies.
 * If the geometry is non-indexed (e.g., after creasing / CSG operations), 
 * it generates a sequential set of indices.
 */
function getGeometryIndices(geom: THREE.BufferGeometry): Uint32Array {
  if (geom.index) {
    return new Uint32Array(geom.index.array);
  }
  const count = geom.attributes.position.count;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    indices[i] = i;
  }
  return indices;
}

/**
 * Builds a collider directly from a shape type's real render geometry
 * (the same cache PrimitiveGeometry draws from), scaled to fit. This is the
 * single dynamic source of truth for "wrap it in its actual boundary" —
 * any shape type not given a fast analytic collider below (cuboid/ball/
 * cylinder/cone) falls through to this instead of a hand-maintained,
 * easily-stale geometry recipe. Add a new primitive to geometryCache.ts and
 * its collider is correct automatically, with no changes needed here.
 */
function buildGeometryColliderConfig(
  type: string,
  safeScale: [number, number, number],
  isDynamic?: boolean
): ColliderConfig {
  const geom = getCachedGeometry(type, "medium").clone();
  geom.scale(safeScale[0], safeScale[1], safeScale[2]);
  const positionAttr = geom.attributes.position;
  const vertices = new Float32Array(positionAttr.array);
  const indices = getGeometryIndices(geom);
  geom.dispose();
  return isDynamic
    ? { type: "hull", args: [vertices] }
    : { type: "trimesh", args: [vertices, indices] };
}

function shoelaceArea(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// Maps (x,y) shape-plane points to the world-space vertices createCogWheelGeometry
// produces after its .center() + .rotateX(Math.PI/2): world = (x, ±halfDepth, y).
function extrudedQuadVertices(
  points: [number, number][],
  halfDepth: number,
): Float32Array {
  const verts: number[] = [];
  for (const h of [halfDepth, -halfDepth]) {
    for (const [x, y] of points) verts.push(x, h, y);
  }
  return new Float32Array(verts);
}

const COGWHEEL_TEETH_BY_TYPE: Record<string, number> = {
  cogwheel: 8,
  "cogwheel-6t": 6,
  "cogwheel-8t": 8,
  "cogwheel-12t": 12,
  "cogwheel-16t": 16,
};

/**
 * Decomposes a dynamic cogwheel into 2 colliders per tooth instead of one
 * hull over the whole gear: a base-ring wedge (bore -> tooth root, full
 * sector) and a tooth wedge (root -> tip, the tooth's own exact profile). A
 * solid hub cylinder was considered and rejected — it has no hole, so it
 * would refill the bore and reproduce the exact bug this is fixing. Both
 * wedge shapes are convex on their own, so each hull is an exact fit, not an
 * approximation. Static bodies skip decomposition entirely — a TrimeshCollider
 * already represents the exact mesh (hole included) correctly for them.
 */
export function getCogwheelCompoundColliders(
  type: string,
  safeScale: [number, number, number],
  isDynamic?: boolean,
): ColliderConfig[] {
  if (!isDynamic) {
    return [buildGeometryColliderConfig(type, safeScale, false)];
  }

  const teeth = COGWHEEL_TEETH_BY_TYPE[type] ?? 8;
  const angleStep = (2 * Math.PI) / teeth;
  // The rendered gear is an ExtrudeGeometry WITH a bevel, so it is thicker
  // than COGWHEEL_DEPTH by one bevelThickness at each face and reaches
  // bevelSize further out than COGWHEEL_OUTER_RADIUS at its widest. Sizing the
  // collider off the bare constants left it measurably thinner and narrower
  // than the mesh it represents. See BUG-021.
  const halfDepth = COGWHEEL_DEPTH / 2 + COGWHEEL_BEVEL_THICKNESS;
  const tipRadius = COGWHEEL_OUTER_RADIUS + COGWHEEL_BEVEL_SIZE;
  // Each wedge's inner edge is a straight chord between two points on the bore
  // circle, and a chord sits INSIDE the arc — at 6 teeth it cut ~13% into the
  // axle hole, so a shaft sized to the bore fitted the mesh but not the
  // collider. Circumscribing pushes the corners out just enough that the chord
  // itself lands on the nominal bore radius.
  const boreCircumscribed = COGWHEEL_BORE_RADIUS / Math.cos(angleStep / 2);

  const raw: { vertices: Float32Array; volume: number }[] = [];

  for (let i = 0; i < teeth; i++) {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = getCogwheelToothProfile(teeth, i);

    const a = i * angleStep;
    const b = a + angleStep;
    const rb0: [number, number] = [Math.cos(a) * boreCircumscribed, Math.sin(a) * boreCircumscribed];
    const rb1: [number, number] = [Math.cos(b) * boreCircumscribed, Math.sin(b) * boreCircumscribed];
    const ri0: [number, number] = [Math.cos(a) * COGWHEEL_INNER_RADIUS, Math.sin(a) * COGWHEEL_INNER_RADIUS];
    const ri1: [number, number] = [Math.cos(b) * COGWHEEL_INNER_RADIUS, Math.sin(b) * COGWHEEL_INNER_RADIUS];
    const baseQuad: [number, number][] = [rb0, ri0, ri1, rb1];
    raw.push({
      vertices: extrudedQuadVertices(baseQuad, halfDepth),
      volume: shoelaceArea(baseQuad) * COGWHEEL_DEPTH,
    });

    // x1/y1 and x2/y2 are the tooth TIPS (at COGWHEEL_OUTER_RADIUS); push them
    // out to the mesh's true widest radius. x0/x3 are root points and stay.
    const tipScale = tipRadius / COGWHEEL_OUTER_RADIUS;
    const toothQuad: [number, number][] = [
      [x0, y0],
      [x1 * tipScale, y1 * tipScale],
      [x2 * tipScale, y2 * tipScale],
      [x3, y3],
    ];
    raw.push({
      vertices: extrudedQuadVertices(toothQuad, halfDepth),
      volume: shoelaceArea(toothQuad) * COGWHEEL_DEPTH,
    });
  }

  const totalVolume = raw.reduce((sum, w) => sum + w.volume, 0) || 1;

  return raw.map((w) => {
    const scaled = new Float32Array(w.vertices.length);
    for (let i = 0; i < w.vertices.length; i += 3) {
      scaled[i] = w.vertices[i] * safeScale[0];
      scaled[i + 1] = w.vertices[i + 1] * safeScale[1];
      scaled[i + 2] = w.vertices[i + 2] * safeScale[2];
    }
    return {
      type: "hull",
      args: [scaled],
      massFraction: w.volume / totalVolume,
    };
  });
}

const TORUS_WEDGE_COUNT = 12;

/**
 * Decomposes a dynamic torus into angular wedges around the main ring (the
 * cogwheel's teeth, but for a donut) so the through-hole stays open instead
 * of being hulled shut. Buckets the real render-mesh vertices by angle
 * around the ring axis (matching createCogWheelGeometry's principle: derive
 * from the same geometry the mesh uses) rather than re-deriving a parametric
 * torus formula, so it can't drift from what's actually rendered. The torus
 * geometry has no post-creation rotation applied (unlike the cogwheel), so
 * it stays in three.js's native orientation — ring in the XY-plane, hole
 * through Z — hence bucketing by atan2(y, x). Static bodies skip
 * decomposition; TrimeshCollider is already correct for them.
 */
export function getTorusCompoundColliders(
  safeScale: [number, number, number],
  isDynamic?: boolean,
  wedgeCount: number = TORUS_WEDGE_COUNT,
): ColliderConfig[] {
  if (!isDynamic) {
    return [buildGeometryColliderConfig("torus", safeScale, false)];
  }

  const geom = getCachedGeometry("torus", "medium"); // read-only — do NOT scale/dispose the shared cache instance
  const posAttr = geom.attributes.position;
  const twoPi = Math.PI * 2;
  const padAngle = (twoPi / wedgeCount) * 0.15; // small overlap so neighboring wedge hulls don't leave a seam gap

  const buckets: number[][] = Array.from({ length: wedgeCount }, () => []);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    let angle = Math.atan2(y, x);
    if (angle < 0) angle += twoPi;
    for (let b = 0; b < wedgeCount; b++) {
      const start = (b / wedgeCount) * twoPi - padAngle;
      const end = ((b + 1) / wedgeCount) * twoPi + padAngle;
      const wrapped = angle < start ? angle + twoPi : angle > end ? angle - twoPi : angle;
      if (wrapped >= start && wrapped <= end) buckets[b].push(x, y, z);
    }
  }

  // All wedges share the same angular width, so — unlike the gear, whose
  // base-ring vs. tooth pieces differ in volume — the torus's mass ends up
  // split evenly across wedges purely by symmetry; no need to compute the
  // actual torus radii to weight them.
  const configs: ColliderConfig[] = [];
  for (let b = 0; b < wedgeCount; b++) {
    const raw = buckets[b];
    if (raw.length < 12) continue; // need >= 4 points for a hull
    const scaled = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 3) {
      scaled[i] = raw[i] * safeScale[0];
      scaled[i + 1] = raw[i + 1] * safeScale[1];
      scaled[i + 2] = raw[i + 2] * safeScale[2];
    }
    configs.push({ type: "hull", args: [scaled] });
  }
  // Normalized across the wedges actually EMITTED, not across the requested
  // wedgeCount. A bucket with too few vertices is skipped above, and the old
  // fixed 1/wedgeCount meant those skipped wedges' mass simply vanished — the
  // body came out lighter than its authored mass with nothing to indicate it.
  // Symmetry still makes every surviving wedge equal, so this only changes the
  // denominator. See BUG-020.
  const share = configs.length > 0 ? 1 / configs.length : 0;
  return configs.map((c) => ({ ...c, massFraction: share }));
}

/**
 * Single entry point every collider-building call site should use instead
 * of getColliderConfig directly — returns 1 config for ordinary shapes, or N
 * for shapes whose real geometry has a hole/concavity a single hull can't
 * represent (dynamic cogwheels, dynamic torus).
 */
export function getShapeColliderConfigs(
  shape: { type: string; scale: [number, number, number]; baseSize?: [number, number, number]; url?: string },
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  isDynamic?: boolean,
): ColliderConfig[] {
  if (shape.type in COGWHEEL_TEETH_BY_TYPE) {
    const safeScale: [number, number, number] = [
      Math.max(0.005, shape.scale[0]),
      Math.max(0.005, shape.scale[1]),
      Math.max(0.005, shape.scale[2]),
    ];
    return getCogwheelCompoundColliders(shape.type, safeScale, isDynamic);
  }
  if (shape.type === "torus") {
    const safeScale: [number, number, number] = [
      Math.max(0.005, shape.scale[0]),
      Math.max(0.005, shape.scale[1]),
      Math.max(0.005, shape.scale[2]),
    ];
    return getTorusCompoundColliders(safeScale, isDynamic);
  }
  return [getColliderConfig(shape, gltfGeometryMap, isDynamic)];
}

/**
 * Extracts the correct arguments for Rapier colliders.
 * Note: Rapier cuboids take half-extents, and cylinders/cones take half-height and radius.
 */
export function getColliderConfig(
  shape: { type: string; scale: [number, number, number]; baseSize?: [number, number, number]; url?: string },
  gltfGeometryMap?: Map<string, THREE.BufferGeometry>,
  isDynamic?: boolean
): ColliderConfig {
  const { type, scale } = shape;

  // Guard against zero/degenerate scaling factors
  const safeScale: [number, number, number] = [
    Math.max(0.005, scale[0]),
    Math.max(0.005, scale[1]),
    Math.max(0.005, scale[2]),
  ];

  switch (type) {
    case "sphere": {
      // A true (uniformly-scaled) sphere gets a cheap BallCollider. A
      // non-uniformly stretched sphere (used as an elongated/rod-like or
      // capsule-ish shape) can't be represented by a single radius — using
      // scale[0] alone would size the ball off whichever axis happens to be
      // longest, producing a collider far bigger than the visible mesh along
      // the thinner axes. Fall back to its real scaled boundary instead.
      const isUniform =
        Math.abs(safeScale[0] - safeScale[1]) < 1e-3 &&
        Math.abs(safeScale[1] - safeScale[2]) < 1e-3;
      if (isUniform) {
        return {
          type: "ball",
          args: [safeScale[0] / 2], // radius
        };
      }
      return buildGeometryColliderConfig("sphere", safeScale, isDynamic);
    }

    // Cylinder and cone take a single radius, so they can only represent a
    // circular cross-section. Scaling X and Z differently makes an oval post,
    // and sizing the radius off X alone gave a collider that disagreed with
    // the visible mesh along Z — a [1,2,4] cylinder got a collider four times
    // too narrow. Fall back to the real scaled boundary in that case, exactly
    // as the sphere branch above already does for non-uniform scale.
    // See BUG-019.
    case "cylinder": {
      const radiallyUniform = Math.abs(safeScale[0] - safeScale[2]) < 1e-3;
      if (!radiallyUniform) return buildGeometryColliderConfig("cylinder", safeScale, isDynamic);
      return {
        type: "cylinder",
        args: [safeScale[1] / 2, safeScale[0] / 2], // [halfHeight, radius]
      };
    }

    case "cone": {
      const radiallyUniform = Math.abs(safeScale[0] - safeScale[2]) < 1e-3;
      if (!radiallyUniform) return buildGeometryColliderConfig("cone", safeScale, isDynamic);
      return {
        type: "cone",
        args: [safeScale[1] / 2, safeScale[0] / 2], // [halfHeight, radius]
      };
    }

    case "torus":
    case "hexagon":
    case "cogwheel":
    case "cogwheel-6t":
    case "cogwheel-8t":
    case "cogwheel-12t":
    case "cogwheel-16t":
      return buildGeometryColliderConfig(type, safeScale, isDynamic);

    case "glb": {
      if (shape.url && gltfGeometryMap && gltfGeometryMap.has(shape.url)) {
        const geom = gltfGeometryMap.get(shape.url)!.clone();
        geom.scale(safeScale[0], safeScale[1], safeScale[2]);
        const positionAttr = geom.attributes.position;
        const vertices = new Float32Array(positionAttr.array);
        const indices = getGeometryIndices(geom);
        geom.dispose();
        return isDynamic
          ? {
              type: "hull",
              args: [vertices],
            }
          : {
              type: "trimesh",
              args: [vertices, indices],
            };
      }
      const extents = shape.baseSize
        ? [safeScale[0] * shape.baseSize[0], safeScale[1] * shape.baseSize[1], safeScale[2] * shape.baseSize[2]]
        : safeScale;
      return {
        type: "cuboid",
        args: [extents[0] / 2, extents[1] / 2, extents[2] / 2],
      };
    }
    
    case "cube":
    case "custom":
    case "group":
    default: {
      const extents = safeScale;
      return {
        type: "cuboid",
        args: [extents[0] / 2, extents[1] / 2, extents[2] / 2], // halfWidth, halfHeight, halfDepth
      };
    }
  }
}

// NOTE: getCompoundColliders and getCSGGroupCompoundColliders were removed here
// (docs/bug-audit-2026-08.md, BUG-033 / BUG-034). Both were dead — zero call
// sites, referenced only by comments describing what replaced them — and both
// carried real defects: an unguarded customMembers recursion, a hole member
// used as the parent frame, an unreachable isHole branch, and a bypass of the
// cogwheel/torus decomposition that getShapeColliderConfigs' own contract
// requires. MemberCollider + CompositeMemberColliders are the live path.
