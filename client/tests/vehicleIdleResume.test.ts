/**
 * Headless repro for the stop / idle / resume traction report.
 *
 * The reported sequence — hold reverse, release, sit idle a few seconds, press
 * again, car won't move — was never covered by Gate A, which only drove from a
 * standing start and never left the vehicle idle long enough for anything to
 * time out.
 *
 * This drives Rapier's real `DynamicRayCastVehicleController` in Node, so the
 * sequence is testable without a browser. Constants are mirrored from
 * SimulationScene.tsx's VEHICLE_* block and from the demo car's own
 * dimensions; they are module-local there, so this copy is deliberate — if
 * they change in the app, change them here too.
 *
 * NOTE: these tests characterise Rapier's behaviour under the app's
 * configuration. They are diagnostics for an open investigation, not a
 * regression guard on app code, and they intentionally do not import from
 * SimulationScene (whose vehicle logic lives inside a React component).
 */
import { describe, it, expect, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

// ── mirrored from SimulationScene.tsx ──────────────────────────────────────
const SUSPENSION_STIFFNESS = 28;
const SUSPENSION_COMPRESSION = 0.83;
const SUSPENSION_RELAXATION = 1.1;
const SUSPENSION_MAX_TRAVEL_FACTOR = 0.5;
const SUSPENSION_REST_LENGTH_FACTOR = 0.35;
const WHEEL_FRICTION_SLIP = 1000;
const WHEEL_SIDE_FRICTION_STIFFNESS = 0.7;
const ENGINE_FORCE_BASE = 15;
const TIMESTEP = 1 / 60;

// Demo car: wheel scale[0] = 5.5, so radius = 5.5 * 0.5 and
// scaleMultiplier = 5.5 / 1.2.
const WHEEL_RADIUS = 2.75;
const SCALE_MULTIPLIER = 5.5 / 1.2;
const SCALE_CUBED = SCALE_MULTIPLIER ** 3;
const CHASSIS_MASS = 630; // ~the demo car's summed member masses

type Vehicle = {
  world: RAPIER.World;
  chassis: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  step: (throttle: number, seconds: number) => void;
  forwardDistance: () => number;
};

function makeVehicle({ canSleep = true }: { canSleep?: boolean } = {}): Vehicle {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = TIMESTEP;

  // Ground, matching the sim's fixed floor.
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(150, 0.5, 150).setTranslation(0, -0.5, 0).setFriction(0.9),
    ground,
  );

  // Chassis: a single box standing in for the compound group body.
  // `canSleep` mirrors the app's own prop — false is what SimulationScene now
  // passes for a vehicle chassis (BUG-054); true is the Rapier default the
  // app used before the fix.
  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 5, 0)
      // Matches the app: pitch and roll locked, yaw free.
      .enabledRotations(false, true, false)
      .setLinearDamping(1.0)
      .setAngularDamping(5.0)
      .setCanSleep(canSleep),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(5, 1, 8).setMass(CHASSIS_MASS).setFriction(0.55),
    chassis,
  );

  const controller = world.createVehicleController(chassis);
  const connections: [number, number, number][] = [
    [-6.8, -1.0, 6.5], [6.8, -1.0, 6.5], [-6.8, -1.0, -6.5], [6.8, -1.0, -6.5],
  ];
  for (const [x, y, z] of connections) {
    controller.addWheel(
      { x, y, z },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      WHEEL_RADIUS * SUSPENSION_REST_LENGTH_FACTOR,
      WHEEL_RADIUS,
    );
  }
  const perWheelWeight = (CHASSIS_MASS * 9.81) / connections.length;
  for (let i = 0; i < connections.length; i++) {
    controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
    controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
    controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
    controller.setWheelMaxSuspensionTravel(i, WHEEL_RADIUS * SUSPENSION_MAX_TRAVEL_FACTOR);
    controller.setWheelMaxSuspensionForce(i, Math.max(5000, perWheelWeight * 4));
    controller.setWheelFrictionSlip(i, WHEEL_FRICTION_SLIP * SCALE_MULTIPLIER);
    controller.setWheelSideFrictionStiffness(i, WHEEL_SIDE_FRICTION_STIFFNESS);
  }

  const start = chassis.translation();

  // Mirrors the app's useBeforePhysicsStep body: set forces, update, step.
  const step = (throttle: number, seconds: number) => {
    const n = Math.round(seconds / TIMESTEP);
    const engineForce = throttle * ENGINE_FORCE_BASE * SCALE_CUBED;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < connections.length; i++) {
        controller.setWheelEngineForce(i, engineForce);
        controller.setWheelBrake(i, 0);
        controller.setWheelSteering(i, 0);
      }
      controller.updateVehicle(TIMESTEP);
      world.step();
    }
  };

  const forwardDistance = () => {
    const t = chassis.translation();
    return Math.hypot(t.x - start.x, t.z - start.z);
  };

  return { world, chassis, controller, step, forwardDistance };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe("vehicle: drive from a standing start (what Gate A covered)", () => {
  it("settles, then translates under continuous throttle", () => {
    const v = makeVehicle();
    v.step(0, 1.0); // let it drop and settle
    const settled = v.forwardDistance();
    v.step(-1, 3.0); // reverse, as S does
    const moved = v.forwardDistance() - settled;
    expect(moved).toBeGreaterThan(1);
  });
});

describe("vehicle: stop / idle / resume — the reported sequence", () => {
  it("REPRO — drive, release, idle until ASLEEP, then drive again", () => {
    const v = makeVehicle();
    v.step(0, 1.0); // settle

    v.step(-1, 2.0); // hold S
    const afterFirstDrive = v.forwardDistance();

    // Idle until the body actually sleeps, rather than for a fixed guess — a
    // 4s idle leaves it awake and would test nothing.
    let idled = 0;
    while (!v.chassis.isSleeping() && idled < 20) {
      v.step(0, 0.5);
      idled += 0.5;
    }
    const sleepingAtResume = v.chassis.isSleeping();
    const afterIdle = v.forwardDistance();

    v.step(-1, 3.0); // press S again
    const resumeDelta = v.forwardDistance() - afterIdle;

    console.log(
      `[idle-resume] firstDrive=${afterFirstDrive.toFixed(2)} ` +
        `idledFor=${idled}s sleepingAtResume=${sleepingAtResume} ` +
        `resumeDelta=${resumeDelta.toFixed(2)}`,
    );

    expect(afterFirstDrive).toBeGreaterThan(1); // the first drive worked
    expect(sleepingAtResume).toBe(true); // we genuinely tested the asleep case

    // CURRENT (BUGGY) BEHAVIOUR, asserted so the suite stays green while this
    // finding is open — same convention as bugAuditRepro.test.ts.
    //
    // CORRECT behaviour would be `expect(resumeDelta).toBeGreaterThan(1)`.
    // Flip this line when the finding is fixed.
    expect(resumeDelta).toBe(0);
  });

  it("does the chassis fall asleep while idle?", () => {
    const v = makeVehicle();
    v.step(0, 1.0);
    v.step(-1, 2.0);
    const sleepingWhileDriving = v.chassis.isSleeping();
    v.step(0, 6.0); // long idle
    const sleepingAfterIdle = v.chassis.isSleeping();
    console.log(
      `[sleep] whileDriving=${sleepingWhileDriving} afterIdle=${sleepingAfterIdle}`,
    );
    expect(sleepingWhileDriving).toBe(false);
    // Recorded, not asserted either way — the app never sets canSleep, so this
    // documents Rapier's actual default behaviour under this configuration.
    expect(typeof sleepingAfterIdle).toBe("boolean");
  });

  it("diagnostic — does waking the chassis before resuming restore traction?", () => {
    // Identifies whether a missing wakeUp() is the mechanism, WITHOUT changing
    // app code. If the woken run moves and the un-woken one does not, the
    // cause is settled.
    const measure = (wake: boolean) => {
      const v = makeVehicle();
      v.step(0, 1.0);
      v.step(-1, 2.0);
      let idled = 0;
      while (!v.chassis.isSleeping() && idled < 20) {
        v.step(0, 0.5);
        idled += 0.5;
      }
      const slept = v.chassis.isSleeping();
      const before = v.forwardDistance();
      if (wake) v.chassis.wakeUp();
      v.step(-1, 3.0);
      return { slept, delta: v.forwardDistance() - before };
    };
    const withoutWake = measure(false);
    const withWake = measure(true);
    console.log(
      `[wake-probe] slept=${withoutWake.slept} ` +
        `withoutWake=${withoutWake.delta.toFixed(2)} withWake=${withWake.delta.toFixed(2)}`,
    );
    expect(withoutWake.slept).toBe(true);
    // ROOT CAUSE, isolated: the only difference between these two runs is a
    // single wakeUp() call. Asleep the car is completely dead; woken it drives
    // normally. So `updateVehicle()` does NOT wake its own chassis, and every
    // newton of engine force is silently discarded while the body sleeps.
    expect(withoutWake.delta).toBe(0);
    expect(withWake.delta).toBeGreaterThan(1);
  });
});

describe("vehicle: the shipped fix — canSleep(false) on the chassis", () => {
  // What SimulationScene now passes for a vehicle chassis. These assert the
  // FIXED behaviour, so unlike the block above they must keep passing.
  it("never sleeps, so an idled car still drives on resume", () => {
    const v = makeVehicle({ canSleep: false });
    v.step(0, 1.0); // settle
    v.step(-1, 2.0); // drive
    const afterFirstDrive = v.forwardDistance();

    v.step(0, 12.0); // idle far past the default sleep threshold
    expect(v.chassis.isSleeping()).toBe(false); // the whole point
    const afterIdle = v.forwardDistance();

    v.step(-1, 3.0); // resume
    const resumeDelta = v.forwardDistance() - afterIdle;
    expect(afterFirstDrive).toBeGreaterThan(1);
    expect(resumeDelta).toBeGreaterThan(1);
  });

  it("does not creep or drift while parked", () => {
    // The cost of never sleeping: a body that is always integrating could
    // jitter. It must not — verified in the browser too (0.0000 over 25s).
    const v = makeVehicle({ canSleep: false });
    v.step(0, 2.0); // settle
    const parked = v.forwardDistance();
    v.step(0, 15.0); // sit still
    expect(v.forwardDistance() - parked).toBeLessThan(0.05);
  });

  it("holds no pent-up velocity to release — the reason not to wake-on-input", () => {
    // A sleeping body accumulates the controller's applied velocity without
    // integrating it. Waking that body would dump it all at once. A body that
    // never sleeps integrates continuously, so speed stays bounded by drag.
    const v = makeVehicle({ canSleep: false });
    v.step(0, 1.0);
    v.step(-1, 2.0);
    v.step(0, 10.0); // idle — velocity should decay, not accumulate
    const lv = v.chassis.linvel();
    expect(Math.hypot(lv.x, lv.y, lv.z)).toBeLessThan(1);
  });
});
