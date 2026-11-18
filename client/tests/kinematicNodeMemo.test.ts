import { describe, it, expect } from "vitest";
import { areKinematicNodePropsEqual as NEW } from "@/components/canvas/KinematicNode";

/**
 * React.memo calls the comparator once per memoized instance and re-renders
 * that instance when it returns false. So counting false-returns across a
 * scene's nodes for a given prop transition == the KinematicNode re-render
 * count a Profiler would report.
 *
 * `OLD` is the comparator exactly as it stood at the commit before this
 * change (the `a.shapes !== b.shapes` / `a.simulationFrame !== b.simulationFrame`
 * blunt identity checks), copied verbatim so we can measure before vs after
 * without a browser.
 */
function OLD(a: Record<string, any>, b: Record<string, any>): boolean {
  const aShape = a.shape;
  const bShape = b.shape;
  if (aShape.id !== bShape.id) return false;
  if (aShape.position.join(",") !== bShape.position.join(",")) return false;
  if (aShape.rotation.join(",") !== bShape.rotation.join(",")) return false;
  if (aShape.scale.join(",") !== bShape.scale.join(",")) return false;
  if (aShape.color !== bShape.color) return false;
  if (aShape.type !== bShape.type) return false;
  if (aShape.url !== bShape.url) return false;
  if (aShape.parentId !== bShape.parentId) return false;
  if (aShape.isHole !== bShape.isHole) return false;
  if (aShape.isLocked !== bShape.isLocked) return false;
  if (aShape.pathId !== bShape.pathId) return false;
  if (aShape.jointAxis !== bShape.jointAxis) return false;
  if (aShape.jointAngle !== bShape.jointAngle) return false;
  if (aShape.motionChannelId !== bShape.motionChannelId) return false;
  if (aShape.jointParentId !== bShape.jointParentId) return false;
  if (aShape.circuitNodeId !== bShape.circuitNodeId) return false;
  if (aShape.grabbedBy !== bShape.grabbedBy) return false;
  if (aShape.isGripper !== bShape.isGripper) return false;
  if ((aShape.gripOffset ?? []).join(",") !== (bShape.gripOffset ?? []).join(",")) return false;
  if ((aShape.jointRotation ?? []).join(",") !== (bShape.jointRotation ?? []).join(",")) return false;
  if (aShape.motionInverted !== bShape.motionInverted) return false;
  if (aShape.mass !== bShape.mass) return false;
  if ((aShape.baseSize ?? []).join(",") !== (bShape.baseSize ?? []).join(",")) return false;
  if (aShape.customMembers !== bShape.customMembers) return false;
  if (a.simulationFrame !== b.simulationFrame) return false;
  if (a.shapes !== b.shapes) return false;
  if (a.motorGroups !== b.motorGroups) return false;
  if (a.selectedIds?.includes(aShape.id) !== b.selectedIds?.includes(bShape.id)) return false;
  if (a.mode !== b.mode) return false;
  if (a.wsSettings?.showJointLabels !== b.wsSettings?.showJointLabels) return false;
  return true;
}

type Shape = Record<string, any>;

function mkShape(id: number, over: Partial<Shape> = {}): Shape {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#cccccc",
    type: "cube",
    ...over,
  };
}

const MG: any[] = []; // stable empty motor-groups array, shared across props

function propsFor(
  shape: Shape,
  shapes: Shape[],
  simulationFrame: any = null,
): Record<string, any> {
  return {
    shape,
    shapes,
    motorGroups: MG,
    simulationFrame,
    selectedIds: [],
    mode: "translate",
    wsSettings: {},
  };
}

/** Count how many nodes each comparator would re-render for a transition. */
function countRerenders(
  prevShapes: Shape[],
  nextShapes: Shape[],
  prevFrame: any = null,
  nextFrame: any = null,
) {
  let old = 0;
  let next = 0;
  for (const ps of prevShapes) {
    const ns = nextShapes.find((s) => s.id === ps.id)!;
    const prevProps = propsFor(ps, prevShapes, prevFrame);
    const nextProps = propsFor(ns, nextShapes, nextFrame);
    if (!OLD(prevProps, nextProps)) old++;
    if (!NEW(prevProps, nextProps)) next++;
  }
  return { old, next };
}

/** 30 shapes: 1 gripper (id 0) grabbing 2 children (ids 1,2); `circuitCount`
 *  of the remaining shapes are circuit-linked. */
function makeScene(circuitCount = 0): Shape[] {
  const shapes: Shape[] = [];
  shapes.push(mkShape(0, { isGripper: true, gripOffset: [0, 1, 0] }));
  shapes.push(mkShape(1, { grabbedBy: 0 }));
  shapes.push(mkShape(2, { grabbedBy: 0 }));
  for (let id = 3; id < 30; id++) {
    const over: Partial<Shape> = {};
    if (id - 3 < circuitCount) over.circuitNodeId = `comp-${id}`;
    shapes.push(mkShape(id, over));
  }
  return shapes;
}

describe("KinematicNode memo — measured re-render counts", () => {
  it("drag one shape in a 30-shape scene", () => {
    const scene = makeScene();
    const draggedId = 15; // an ordinary shape, not the gripper, not a grabbed child
    const next = scene.map((s) =>
      s.id === draggedId ? { ...s, position: [1, 2, 3] } : s,
    );
    const { old, next: n } = countRerenders(scene, next);
    // Report:
    //   before: every node (a.shapes identity changed)
    //   after:  only the shape that actually moved
    expect(old).toBe(30);
    expect(n).toBe(1);
  });

  it("one streamed simulation frame, 5 of 30 shapes circuit-linked", () => {
    const scene = makeScene(5);
    const frameA = { running: true, components: {} };
    const frameB = { running: true, components: {} }; // new identity, same content
    // shapes array identity unchanged between frames; only simulationFrame differs
    const { old, next: n } = countRerenders(scene, scene, frameA, frameB);
    expect(old).toBe(30); // every node re-rendered per frame
    expect(n).toBe(5); // only the circuit-linked shapes
  });

  it("streamed frame with zero circuit-linked shapes", () => {
    const scene = makeScene(0);
    const fA = { running: true, components: {} };
    const fB = { running: true, components: {} };
    const { old, next: n } = countRerenders(scene, scene, fA, fB);
    expect(old).toBe(30);
    expect(n).toBe(0); // nothing to update -> no re-renders at all
  });
});

describe("KinematicNode memo — gripper grabbed-children logic (functional)", () => {
  const scene = () => makeScene();

  it("single gripper: grabbing a new child re-renders the gripper node", () => {
    const before = scene();
    const after = before.map((s) => s); // new array identity
    after.push(mkShape(50, { grabbedBy: 0 })); // gripper 0 grabs id 50
    const gripperBefore = before.find((s) => s.id === 0)!;
    const gripperAfter = after.find((s) => s.id === 0)!;
    const equal = NEW(
      propsFor(gripperBefore, before),
      propsFor(gripperAfter, after),
    );
    expect(equal).toBe(false); // must re-render to mount the new child node
  });

  it("single gripper: releasing a child re-renders the gripper node", () => {
    const before = scene();
    const after = before.map((s) => (s.id === 2 ? { ...s, grabbedBy: undefined } : s));
    const equal = NEW(
      propsFor(before.find((s) => s.id === 0)!, before),
      propsFor(after.find((s) => s.id === 0)!, after),
    );
    expect(equal).toBe(false);
  });

  it("two grippers: gripper A does NOT re-render when gripper B grabs something", () => {
    const before = [
      mkShape(100, { isGripper: true }),
      mkShape(200, { isGripper: true }),
      mkShape(1, { grabbedBy: 100 }),
      mkShape(2, { grabbedBy: 200 }),
      ...Array.from({ length: 10 }, (_, i) => mkShape(300 + i)),
    ];
    // B (200) grabs a new shape; new array identity; A's grabbed set unchanged
    const after = before.map((s) => s);
    after.push(mkShape(3, { grabbedBy: 200 }));

    const aEqual = NEW(
      propsFor(before.find((s) => s.id === 100)!, before),
      propsFor(after.find((s) => s.id === 100)!, after),
    );
    const bEqual = NEW(
      propsFor(before.find((s) => s.id === 200)!, before),
      propsFor(after.find((s) => s.id === 200)!, after),
    );
    expect(aEqual).toBe(true); // no spurious re-render of gripper A
    expect(bEqual).toBe(false); // gripper B must re-render for its new child
  });

  it("gripper does NOT re-render when an unrelated third shape moves", () => {
    const before = scene();
    const after = before.map((s) =>
      s.id === 20 ? { ...s, position: [9, 9, 9] } : s,
    ); // new array identity, one unrelated shape moved
    const equal = NEW(
      propsFor(before.find((s) => s.id === 0)!, before),
      propsFor(after.find((s) => s.id === 0)!, after),
    );
    expect(equal).toBe(true); // gripper's grabbed set unchanged -> skip
  });

  it("non-gripper node ignores gripper grabbed-set changes entirely", () => {
    const before = scene();
    const after = before.map((s) => s);
    after.push(mkShape(60, { grabbedBy: 0 }));
    const ordinary = before.find((s) => s.id === 25)!;
    const ordinaryAfter = after.find((s) => s.id === 25)!;
    expect(NEW(propsFor(ordinary, before), propsFor(ordinaryAfter, after))).toBe(
      true,
    );
  });
});
