import React, {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, useGLTF, GizmoHelper } from "@react-three/drei";
import { CleanAxisMap } from "./CleanAxisMap";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  BallCollider,
  CylinderCollider,
  ConeCollider,
  useRevoluteJoint,
  useRapier,
  useBeforePhysicsStep,
  useAfterPhysicsStep,
  MeshCollider,
} from "@react-three/rapier";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import type {
  ShapeType,
  GroupType,
  MotorGroup,
  MotionPath,
  CustomMember,
} from "../../App";
import { getShapeMaterialProps } from "../../lib/materialUtils";
import { resolveShapeMass } from "../../lib/physicsUtils";
import type {
  CircuitStreamComponentState,
  CircuitStreamFrame,
} from "../../lib/circuitStream";
import CustomShapeMesh from "./CustomShapeMesh";
import CSGGroup from "./CSGGroup";
import { SuspendedGlbShapeMesh } from "./GlbShapeMesh";
import PrimitiveGeometry from "./PrimitiveGeometry";
import ShapeMaterial from "./ShapeMaterial";

import { Evaluator } from "three-bvh-csg";
import VoxelizedShapeBody from "./VoxelizedShapeBody";
import MemberCollider from "./MemberCollider";
import { shouldVoxelizeShape } from "../../lib/hollowShapeVoxelization";

// Shape of the dev-only telemetry published by RaycastVehicle below, for an
// external driver script to assert on. Declared rather than cast so a
// consumer and the producer stay in agreement.
export type VehicleProbe = {
  t: number;
  chassis: {
    pos: [number, number, number];
    linvel: [number, number, number];
    angvel: [number, number, number];
    speed: number;
    sleeping: boolean | null;
    mass: number | null;
  };
  input: { throttle: number; brake: number; steer: number };
  wheels: Array<{
    id: number;
    isDrive: boolean;
    inContact: boolean | null;
    suspension: number | null;
    steering: number | null;
    rollAngle: number;
  }>;
};

declare global {
  interface Window {
    __vehicleProbe?: VehicleProbe;
  }
}

function getAutoColliderType(
  shapeType: string,
  isStatic: boolean,
): "cuboid" | "ball" | "trimesh" | "hull" {
  if (shapeType === "cube") return "cuboid";
  if (shapeType === "sphere") return "ball";
  return isStatic ? "trimesh" : "hull";
}

type SimulationSceneProps = {
  shapes: ShapeType[];
  groups: GroupType[];
  motorGroups: MotorGroup[];
  paths: MotionPath[];
  isPlaying: boolean;
  debugOutlines: boolean;
  gravity: [number, number, number];
  wsSettings: any;
  customMotorSpeeds?: Map<number, [number, number, number]>;
  circuitFrame?: CircuitStreamFrame | null;
};
function getMotorRpmFromComponent(component: CircuitStreamComponentState) {
  const telemetry = component.telemetry ?? {};
  const directRpm = Number(telemetry.rpm ?? 0);
  if (Number.isFinite(directRpm) && Math.abs(directRpm) > 0) return Math.abs(directRpm);

  const forwardThrottle = Number(telemetry.forwardThrottle ?? 0);
  const reverseThrottle = Number(telemetry.reverseThrottle ?? 0);
  const throttle = Math.max(
    Number.isFinite(forwardThrottle) ? Math.abs(forwardThrottle) : 0,
    Number.isFinite(reverseThrottle) ? Math.abs(reverseThrottle) : 0,
    typeof component.brightness === "number" ? Math.abs(component.brightness) : 0,
  );
  if (throttle > 0) return Math.min(2400, throttle * 2400);

  const voltage = Math.max(
    typeof component.voltage === "number" ? Math.abs(component.voltage) : 0,
    typeof telemetry.voltage === "number" ? Math.abs(telemetry.voltage) : 0,
  );
  return voltage > 0 ? Math.min(2400, (voltage / 9) * 2400) : 0;
}

function getLinkedMotorSpeed(
  shape: ShapeType | undefined,
  motorGroup: MotorGroup | undefined,
  frame?: CircuitStreamFrame | null,
) {
  if (!frame?.running || !frame.components) {
    return undefined;
  }

  const speedFor = (component: CircuitStreamComponentState | undefined) => {
    if (!component) return undefined;

    // Handle dcmotor components
    if (component.componentType === "dcmotor") {
      const rpm = getMotorRpmFromComponent(component);
      if (!Number.isFinite(rpm) || rpm <= 0) return 0;
      const direction = String(component.telemetry?.direction ?? "forward");
      const sign = direction === "reverse" ? 1 : -1;
      return sign * Math.min(30, (rpm / 2400) * 30);
    }

    // Handle any component with RPM telemetry
    const rpm = component.telemetry?.rpm;
    if (typeof rpm === "number" && rpm !== 0) {
      const direction = String(component.telemetry?.direction ?? "forward");
      const sign = direction === "reverse" ? 1 : -1;
      return sign * Math.min(30, (Math.abs(rpm) / 2400) * 30);
    }

    return undefined;
  };

  const candidates = [
    shape?.circuitNodeId?.trim(),
    motorGroup?.motionChannelId?.trim(),
  ].filter(Boolean) as string[];

  for (const id of candidates) {
    const component = frame.components[id];
    const speed = speedFor(component);
    if (typeof speed === "number") return speed;
  }

  // Fallback: try to find by label
  for (const id of candidates) {
    const byLabel = Object.values(frame.components).find((component) => {
      const label = String(component.label ?? "").trim();
      return label !== "" && label === id;
    });
    const speed = speedFor(byLabel);
    if (typeof speed === "number") return speed;
  }

  // Ultimate fallback: use the first component with RPM telemetry if no specific match
  for (const component of Object.values(frame.components)) {
    const speed = speedFor(component);
    if (typeof speed === "number" && speed !== 0) return speed;
  }

  return undefined;
}


type CircuitVehicleControls = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
  driveSpeed?: number;
};

function getCircuitLabel(component: CircuitStreamComponentState) {
  return String(component.label ?? "").trim().toUpperCase();
}

function getCircuitComponentActive(component: CircuitStreamComponentState) {
  const telemetry = component.telemetry ?? {};
  const pins = Object.values(component.pins ?? {});
  return Boolean(component.isPowered) ||
    (typeof component.brightness === "number" && component.brightness > 0.01) ||
    (typeof component.voltage === "number" && Math.abs(component.voltage) > 0.05) ||
    pins.some((pin) => Boolean(pin.active) || Math.abs(Number(pin.voltage ?? 0)) > 0.05 || Math.abs(Number(pin.normalizedValue ?? 0)) > 0.05) ||
    Object.entries(telemetry).some(([key, value]) => {
      const k = key.toLowerCase();
      return (k.includes("press") || k.includes("state") || k.includes("active")) &&
        (value === true || value === "on" || value === "pressed" || value === 1);
    });
}

function deriveCircuitVehicleControls(frame?: CircuitStreamFrame | null): CircuitVehicleControls {
  if (!frame?.running || !frame.components) {
    return { forward: false, backward: false, left: false, right: false, brake: false };
  }

  const components = Object.values(frame.components);
  const activeLabel = (tokens: string[]) =>
    components.some((component) => {
      const label = getCircuitLabel(component);
      return getCircuitComponentActive(component) && tokens.some((token) => label.includes(token));
    });

  const motors = components
    .map((component) => {
      // Handle dcmotor components
      if (component.componentType === "dcmotor") {
        const rpm = getMotorRpmFromComponent(component);
        const direction = String(component.telemetry?.direction ?? "forward").toLowerCase();
        return { rpm, direction };
      }

      // Handle any component with RPM telemetry
      const rpm = component.telemetry?.rpm;
      if (typeof rpm === "number" && rpm !== 0) {
        const direction = String(component.telemetry?.direction ?? "forward").toLowerCase();
        return { rpm: Math.abs(rpm), direction };
      }

      return null;
    })
    .filter((motor): motor is { rpm: number; direction: string } => motor !== null && motor.rpm > 0);

  const maxRpm = motors.reduce((max, motor) => Math.max(max, motor.rpm), 0);
  const speed = maxRpm <= 0 ? 0 : Math.min(30, (maxRpm / 2400) * 30);

  const stopCommand = activeLabel(["STOP", "BRAKE", "BREAK"]);
  const forwardCommand = activeLabel(["FORWARD", "AAGE", "FRONT"]);
  const backCommand = activeLabel(["BACK", "REVERSE", "PICHE"]);
  const leftCommand = activeLabel(["LEFT"]);
  const rightCommand = activeLabel(["RIGHT"]);

  const servoAngles = components
    .filter((component) => component.componentType === "servo" && getCircuitComponentActive(component))
    .map((component) => Number(component.telemetry?.angle ?? 90))
    .filter((angle) => Number.isFinite(angle));
  const steerAngle = servoAngles.length > 0 ? servoAngles[0] : 90;

  const forwardMotors = motors.filter((motor) => motor.direction !== "reverse").length;
  const reverseMotors = motors.filter((motor) => motor.direction === "reverse").length;
  const inferredBack = reverseMotors > forwardMotors;

  const driveSpeed = stopCommand || speed <= 0
    ? 0
    : backCommand || (!forwardCommand && inferredBack)
      ? speed
      : -speed;

  return {
    forward: driveSpeed < 0,
    backward: driveSpeed > 0,
    left: leftCommand || steerAngle < 80,
    right: rightCommand || steerAngle > 100,
    brake: stopCommand,
    driveSpeed,
  };
}

// â”€â”€ Direct Velocity Driver (for custom motors â€” supports motor/xyz_rotation/linear) â”€â”€
function CustomMotorDirectSpinner({
  bodyRef,
  axis,
  speed,
  motionType,
}: {
  bodyRef: React.RefObject<any>;
  axis: [number, number, number];
  speed: [number, number, number];
  motionType?: "motor" | "xyz_rotation" | "linear";
}) {
  useFrame(() => {
    if (!bodyRef.current) return;
    const type = motionType || "motor";

    if (type === "motor") {
      // Single-axis rotation: speed[0] is the magnitude, applied along jointAxis
      const s = speed[0];
      if (s === 0) return;
      bodyRef.current.setAngvel(
        { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s },
        true,
      );
    } else if (type === "xyz_rotation") {
      // Independent X/Y/Z angular velocities
      if (speed[0] === 0 && speed[1] === 0 && speed[2] === 0) return;
      bodyRef.current.setAngvel(
        { x: speed[0], y: speed[1], z: speed[2] },
        true,
      );
    } else if (type === "linear") {
      // Linear translation velocity on X/Y/Z
      if (speed[0] === 0 && speed[1] === 0 && speed[2] === 0) return;
      bodyRef.current.setLinvel(
        { x: speed[0], y: speed[1], z: speed[2] },
        true,
      );
    }
  });
  return null;
}

// Torque scaling for a custom-motor revolute joint, in the same spirit as
// the vehicle drive joints' torqueFactor: a fixed max-force number would be
// too weak for a scaled-up mechanism and too strong (jittery) for a small
// one, so it's scaled by the shape's own size instead of a global constant.
const CUSTOM_MOTOR_TORQUE_BASE = 40;

/**
 * Drives a single-axis rotational "motor" custom motor group (the common
 * case: a hinge, turntable, cogwheel, or arm swing) via a real Rapier
 * revolute joint anchored at the group's configured pivot, instead of
 * setAngvel'ing the shape's own free-floating body. This is what makes the
 * shape actually orbit/hinge around its authored pivot (matching what the
 * CAD editor's kinematic-mode preview shows) rather than spin in place
 * around its own origin, and makes minLimit/maxLimit real mechanical stops
 * instead of being silently ignored. Velocity-controlled (not
 * position/servo-controlled) to match the speed slider Physics Lab already
 * exposes for custom motors — same control paradigm as the vehicle drive
 * joints already validated this session, just properly pivot-anchored.
 */
function CustomRevoluteMotor({
  pivotRef,
  shapeRef,
  anchor1,
  anchor2,
  axis,
  limits,
  speed,
  torqueScale = 1.0,
}: {
  pivotRef: React.RefObject<any>;
  shapeRef: React.RefObject<any>;
  anchor1: [number, number, number];
  anchor2: [number, number, number];
  axis: [number, number, number];
  limits?: [number, number];
  speed: number;
  torqueScale?: number;
}) {
  const jointRef = useRevoluteJoint(pivotRef, shapeRef, [
    anchor1,
    anchor2,
    axis,
    limits,
  ]);

  useFrame(() => {
    if (!jointRef.current) return;
    if (speed === 0) {
      // Free-spin when idle, matching CustomMotorDirectSpinner's old
      // no-input behavior (no artificial resistance holding it in place).
      jointRef.current.configureMotorVelocity(0, 0.0);
      return;
    }
    jointRef.current.configureMotorVelocity(speed, CUSTOM_MOTOR_TORQUE_BASE * torqueScale);
  });

  return null;
}

// â”€â”€ Kinematic Steering Wheel â€” follows chassis directly, no joint oscillation â”€â”€
function KinematicSteerFollower({
  chassisRef,
  wheelRef,
  localOffset,
  baseRotation,
  wheelRadius,
  steerable = true,
  rollable = true,
  keyboardControls,
}: {
  chassisRef: React.RefObject<any>;
  wheelRef: React.RefObject<any>;
  localOffset: [number, number, number];
  baseRotation: [number, number, number];
  wheelRadius: number;
  steerable?: boolean;
  rollable?: boolean;
  keyboardControls: React.MutableRefObject<{
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    brake: boolean;
  }>;
}) {
  const steerAngle = useRef(0);
  const rollAngle = useRef(0);

  useFrame((_state, delta) => {
    if (!wheelRef.current || !chassisRef.current) return;

    const cp = chassisRef.current.translation();
    const cr = chassisRef.current.rotation();
    const chassisQuat = new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w);

    // Smooth steer interpolation
    const target = keyboardControls.current.left
      ? 0.45
      : keyboardControls.current.right
        ? -0.45
        : 0;
    steerAngle.current +=
      ((steerable ? target : 0) - steerAngle.current) * Math.min(1, delta * 8);

    // Rolling: derive from chassis linear velocity so wheels look realistic
    const vel = chassisRef.current.linvel();
    const chassisForward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      chassisQuat,
    );
    // Project velocity onto chassis forward to get signed speed
    const signedSpeed = chassisForward.dot(
      new THREE.Vector3(vel.x, vel.y, vel.z),
    );
    const safeRadius = wheelRadius > 0.01 ? wheelRadius : 0.5;
    if (rollable) {
      rollAngle.current += (signedSpeed / safeRadius) * delta;
    }

    // World pos = chassis_pos + rotate(localOffset, chassisRot)
    const localVec = new THREE.Vector3(...localOffset).applyQuaternion(
      chassisQuat,
    );
    const worldPos = new THREE.Vector3(cp.x, cp.y, cp.z).add(localVec);

    // Keep the wheel's original sideways cylinder orientation, then roll around
    // the cylinder's own local axle after steering yaw is applied.
    const steerQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      steerAngle.current,
    );
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      rollAngle.current,
    );
    const baseQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...baseRotation),
    );
    const worldQuat = chassisQuat
      .clone()
      .multiply(steerQuat)
      .multiply(baseQuat)
      .multiply(rollQuat);

    wheelRef.current.setNextKinematicTranslation(worldPos);
    wheelRef.current.setNextKinematicRotation(worldQuat);
  });

  return null;
}

type VehicleWheelConfig = {
  shapeId: number;
  meshRef: React.RefObject<THREE.Group | null>;
  // Position relative to the chassis RigidBody's own origin, in the
  // chassis's local (unrotated) frame — Rapier's addWheel expects this
  // directly, no per-frame recomputation needed since it's fixed at
  // creation (the chassis body itself moves; the wheel's attachment point
  // relative to it doesn't).
  chassisConnectionCs: [number, number, number];
  // Which local chassis axis this wheel rolls about — reuses the motor
  // group's own jointAxis field (the same one the old revolute-joint code
  // used), so a user's authored axle orientation is respected either way.
  axleCs: [number, number, number];
  radius: number;
  isDrive: boolean;
  isSteer: boolean;
};

// Starting suspension/friction constants for Rapier's raycast vehicle
// controller. Not physically derived from the demo car's real-world specs —
// picked as reasonable defaults and verified empirically (rest stability +
// driving) the same way every other constant in this file was tuned.
// Re-tune if a given vehicle bottoms out, bounces, or feels too stiff/loose.
const VEHICLE_SUSPENSION_STIFFNESS = 28;
const VEHICLE_SUSPENSION_COMPRESSION = 0.83;
const VEHICLE_SUSPENSION_RELAXATION = 1.1;
const VEHICLE_SUSPENSION_MAX_TRAVEL_FACTOR = 0.5; // × wheel radius
const VEHICLE_SUSPENSION_REST_LENGTH_FACTOR = 0.35; // × wheel radius
const VEHICLE_WHEEL_FRICTION_SLIP = 1000;
const VEHICLE_WHEEL_SIDE_FRICTION_STIFFNESS = 0.7;
const VEHICLE_MAX_STEER_ANGLE = 0.5; // radians (~28.6°)
const VEHICLE_STEER_LERP_SPEED = 6; // per second
// Per-wheel engine force (Newtons) at scaleMultiplier=1, scaled by scaleCubed
// like mass scales with volume. Calibrated against the demo car (~630kg
// compound chassis, scaleMultiplier≈4.58 ⇒ scaleCubed≈96, 4 driven wheels):
// 15 × 96 ≈ 1440N/wheel × 4 ≈ 5760N total ≈ 0.93g acceleration — a first
// pass at "sporty but not absurd"; the original guess of 3000 here was
// ~200× too strong and launched the car off the visible ground within
// about a second, confirmed via direct driving test.
const VEHICLE_ENGINE_FORCE_BASE = 15;
const VEHICLE_BRAKE_FORCE_BASE = 6; // × scaleMultiplier³ — wheelBrake is an impulse, not a continuous force, so needs a much smaller base than engine force

/**
 * Drives a chassis's wheels via Rapier's built-in raycast vehicle
 * controller (suspension springs + tire friction against the ground)
 * instead of separate wheel rigid bodies jointed to the chassis. Steering
 * and driving forces are therefore genuinely friction-derived — the car
 * turns because an angled front wheel's contact patch resists sideways
 * slip, not because the chassis body is spun directly. This also sidesteps
 * the wheel-joint/compound-chassis-inertia instability class entirely:
 * wheels here are virtual raycasts, not separate bodies with their own
 * anchors that could ever mismatch the chassis's true origin.
 */
function RaycastVehicle({
  chassisRef,
  wheels,
  keyboardControls,
  circuitDriveSpeed,
  scaleMultiplier = 1.0,
}: {
  chassisRef: React.RefObject<any>;
  wheels: VehicleWheelConfig[];
  keyboardControls: React.MutableRefObject<{
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    brake: boolean;
  }>;
  // A circuit-simulation stream can drive the vehicle programmatically
  // instead of (or in addition to) keyboard input — matches the old
  // SimulationMotorJoint's motorSpeed override. The raycast controller is
  // force-controlled rather than velocity-controlled, so this can only
  // sensibly carry over as a direction override (full engine force forward
  // or backward), same coarse fidelity the keyboard path already has.
  circuitDriveSpeed?: number;
  scaleMultiplier?: number;
}) {
  const { world } = useRapier();
  const controllerRef = useRef<any>(null);
  const steerAngleRef = useRef(0);
  // Rapier's own wheelRotation() never advances in this build — confirmed
  // via direct measurement (logged every frame across a multi-second drive,
  // stayed at exactly 0.0000 throughout, including well after the chassis
  // was moving and every wheel was in contact) rather than assumed. Rolling
  // the wheel mesh is therefore integrated here instead, from the chassis's
  // own forward speed at each wheel's radius (rolling-without-slipping
  // approximation) — visually correct for the common case, even though it
  // can't show genuine per-wheel slip during hard turns the way a fully
  // accurate simulation would.
  const rollAngleRef = useRef<number[]>(wheels.map(() => 0));
  // Last input actually applied, captured for the dev-only telemetry below.
  const lastInputRef = useRef<{ throttle: number; brake: number; steer: number }>({
    throttle: 0,
    brake: 0,
    steer: 0,
  });

  // Controller creation lives inside the physics loop, not a plain
  // useEffect gated on chassisRef.current — mutating a ref's .current never
  // retriggers an effect, so if react-three-rapier hadn't finished
  // attaching the chassis RigidBody's imperative handle at the exact moment
  // that effect first ran, the controller was silently never created: the
  // chassis (a real physics body) kept moving while every wheel stayed
  // frozen at its static initial pose forever. useBeforePhysicsStep runs
  // every physics tick regardless, so lazily creating the controller here
  // the first time chassisRef.current is actually available removes the
  // race entirely — worst case it's ready one physics frame later, not never.
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        world.removeVehicleController(controllerRef.current);
        controllerRef.current = null;
      }
    };
  }, [world]);

  useBeforePhysicsStep((w) => {
    if (!controllerRef.current) {
      if (!chassisRef.current || wheels.length === 0) return;

      // Suspension force is sized off the chassis's mass, and that mass comes
      // entirely from colliders (see BUG-006) — which for a hollow CSG or
      // concave-GLB chassis resolve asynchronously in the voxel worker. Read
      // too early, mass is 0, the max suspension force collapses to its 5000
      // floor, and the vehicle sinks or bottoms out for the rest of the
      // session because this block only ever runs once.
      //
      // Waiting is safe: useBeforePhysicsStep runs every tick, so the worst
      // case is the controller appearing a few frames later rather than never.
      // See BUG-002.
      const chassisMassNow = chassisRef.current.mass?.() ?? 0;
      if (chassisMassNow <= 0) return;

      const controller = world.createVehicleController(chassisRef.current);
      wheels.forEach((wc) => {
        controller.addWheel(
          { x: wc.chassisConnectionCs[0], y: wc.chassisConnectionCs[1], z: wc.chassisConnectionCs[2] },
          { x: 0, y: -1, z: 0 },
          { x: wc.axleCs[0], y: wc.axleCs[1], z: wc.axleCs[2] },
          wc.radius * VEHICLE_SUSPENSION_REST_LENGTH_FACTOR,
          wc.radius,
        );
      });

      // Suspension force needs to comfortably exceed each wheel's static
      // share of the chassis's weight, or the vehicle sinks/bottoms out
      // just sitting at rest. Guaranteed non-zero by the guard above.
      const perWheelWeight = (chassisMassNow * 9.81) / Math.max(1, wheels.length);

      wheels.forEach((wc, i) => {
        controller.setWheelSuspensionStiffness(i, VEHICLE_SUSPENSION_STIFFNESS);
        controller.setWheelSuspensionCompression(i, VEHICLE_SUSPENSION_COMPRESSION);
        controller.setWheelSuspensionRelaxation(i, VEHICLE_SUSPENSION_RELAXATION);
        controller.setWheelMaxSuspensionTravel(i, wc.radius * VEHICLE_SUSPENSION_MAX_TRAVEL_FACTOR);
        controller.setWheelMaxSuspensionForce(i, Math.max(5000, perWheelWeight * 4));
        controller.setWheelFrictionSlip(i, VEHICLE_WHEEL_FRICTION_SLIP * scaleMultiplier);
        controller.setWheelSideFrictionStiffness(i, VEHICLE_WHEEL_SIDE_FRICTION_STIFFNESS);
      });

      controllerRef.current = controller;
    }

    const controller = controllerRef.current;
    if (!controller) return;

    const controls = keyboardControls.current;
    const throttleInput =
      circuitDriveSpeed !== undefined && circuitDriveSpeed !== 0
        ? Math.sign(circuitDriveSpeed)
        : (controls.forward ? 1 : 0) + (controls.backward ? -1 : 0);
    const steerInput = (controls.left ? 1 : 0) + (controls.right ? -1 : 0);

    const targetSteer = steerInput * VEHICLE_MAX_STEER_ANGLE;
    steerAngleRef.current +=
      (targetSteer - steerAngleRef.current) * Math.min(1, w.timestep * VEHICLE_STEER_LERP_SPEED);

    const scaleCubed = Math.pow(scaleMultiplier, 3);
    const engineForce = throttleInput * VEHICLE_ENGINE_FORCE_BASE * scaleCubed;
    const brakeForce = controls.brake ? VEHICLE_BRAKE_FORCE_BASE * scaleCubed : 0;

    lastInputRef.current = {
      throttle: throttleInput,
      brake: brakeForce,
      steer: steerAngleRef.current,
    };

    wheels.forEach((wc, i) => {
      controller.setWheelEngineForce(i, wc.isDrive ? engineForce : 0);
      controller.setWheelBrake(i, brakeForce);
      controller.setWheelSteering(i, wc.isSteer ? steerAngleRef.current : 0);
    });

    controller.updateVehicle(w.timestep);

    // See rollAngleRef's declaration comment: Rapier's own wheelRotation()
    // doesn't advance, so roll is self-integrated from the chassis's actual
    // forward speed (rolling-without-slipping) instead.
    if (chassisRef.current) {
      const cr = chassisRef.current.rotation();
      const chassisQuat = new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(chassisQuat);
      const linvel = chassisRef.current.linvel();
      const forwardSpeed = forward.dot(new THREE.Vector3(linvel.x, linvel.y, linvel.z));
      wheels.forEach((wc, i) => {
        const angularSpeed = forwardSpeed / Math.max(0.01, wc.radius);
        rollAngleRef.current[i] = (rollAngleRef.current[i] ?? 0) + angularSpeed * w.timestep;
      });
    }
  });

  useAfterPhysicsStep(() => {
    const controller = controllerRef.current;
    if (!controller || !chassisRef.current) return;

    const cp = chassisRef.current.translation();
    const cr = chassisRef.current.rotation();
    const chassisPos = new THREE.Vector3(cp.x, cp.y, cp.z);
    const chassisQuat = new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w);

    wheels.forEach((wc, i) => {
      if (!wc.meshRef.current) return;

      const suspLen =
        controller.wheelSuspensionLength(i) ?? wc.radius * VEHICLE_SUSPENSION_REST_LENGTH_FACTOR;
      const localPos = new THREE.Vector3(
        wc.chassisConnectionCs[0],
        wc.chassisConnectionCs[1] - suspLen,
        wc.chassisConnectionCs[2],
      );
      const worldPos = localPos.applyQuaternion(chassisQuat).add(chassisPos);

      const steer = controller.wheelSteering(i) ?? 0;
      const roll = rollAngleRef.current[i] ?? 0;
      // Scene-graph-style composition: chassis frame → steer-hinge child →
      // roll-axle grandchild. axleCs is expressed in the steer-hinge's own
      // local frame (i.e. pre-steer), which is correct for a nested
      // transform regardless of what steerQuat did to the parent frame.
      const steerQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steer);
      const rollQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(wc.axleCs[0], wc.axleCs[1], wc.axleCs[2]),
        roll,
      );
      const worldQuat = chassisQuat.clone().multiply(steerQuat).multiply(rollQuat);

      wc.meshRef.current.position.copy(worldPos);
      wc.meshRef.current.quaternion.copy(worldQuat);
    });

    // ── dev-only telemetry ────────────────────────────────────────────────
    // Publishes the vehicle's live state so an automated driver can assert
    // on physics rather than on pixels.
    // `(process.env.NODE_ENV !== "production")` is statically false in a production build, so
    // this whole block is dropped by the bundler — it costs shipped users
    // nothing. Instrumentation only; it reads state and never writes any.
    if ((process.env.NODE_ENV !== "production") && chassisRef.current) {
      const body = chassisRef.current;
      const t = body.translation();
      const lv = body.linvel();
      const av = body.angvel();
      window.__vehicleProbe = {
        t: performance.now(),
        chassis: {
          pos: [t.x, t.y, t.z],
          linvel: [lv.x, lv.y, lv.z],
          angvel: [av.x, av.y, av.z],
          speed: Math.hypot(lv.x, lv.y, lv.z),
          sleeping: body.isSleeping?.() ?? null,
          mass: body.mass?.() ?? null,
        },
        input: lastInputRef.current,
        wheels: wheels.map((wc, i) => ({
          id: wc.shapeId,
          isDrive: wc.isDrive,
          inContact: controller.wheelIsInContact?.(i) ?? null,
          suspension: controller.wheelSuspensionLength?.(i) ?? null,
          steering: controller.wheelSteering?.(i) ?? null,
          // Integrated visual roll — the number that decides whether the
          // wheels LOOK like they are spinning.
          rollAngle: rollAngleRef.current[i] ?? 0,
        })),
      };
    }
  });

  return null;
}

export default function SimulationScene({
  shapes,
  groups,
  motorGroups,
  paths,
  isPlaying,
  debugOutlines,
  gravity,
  wsSettings,
  customMotorSpeeds,
  circuitFrame,
}: SimulationSceneProps) {
  const { camera, raycaster, pointer, scene: threeScene, gl } = useThree();
  const evaluator = useMemo(() => {
    const e = new Evaluator();
    e.attributes = ["position", "normal", "color", "uv"];
    return e;
  }, []);

  // Reference wheel diameter the VEHICLE_* force constants were calibrated
  // against. A vehicle whose wheels are this size gets scaleMultiplier 1.0.
  const REFERENCE_WHEEL_DIAMETER = 1.2;

  const getRootGroupId = useCallback(
    (groupId: number): number => {
      let currentId = groupId;
      // Same guard as getAssemblyRootId in canvas/utils/GrabbingSystem.ts.
      // Without it a cyclic parentGroupId spins this loop forever — and
      // because it is a `while (true)` on the main thread rather than a
      // recursion, it hangs the tab outright instead of throwing something
      // an error boundary could catch.
      const seen = new Set<number>([currentId]);
      while (true) {
        const g = groups.find((group) => group.id === currentId);
        if (!g || !g.parentGroupId || g.isJoint) break;
        if (seen.has(g.parentGroupId)) {
          // Returning the last id reached, not a sentinel: every caller uses
          // this purely as a grouping key (`getRootGroupId(a) === getRootGroupId(b)`),
          // and the walk is deterministic, so two members of the same cyclic
          // group still break at the same id and still group together. A
          // sentinel like -1 would collapse every distinct cycle in the scene
          // into one bogus group.
          console.warn(
            `[SimulationScene] cyclic parentGroupId chain detected at group ${g.parentGroupId}; ` +
              `treating ${currentId} as the root. The saved group structure is malformed.`,
          );
          break;
        }
        seen.add(g.parentGroupId);
        currentId = g.parentGroupId;
      }
      return currentId;
    },
    [groups],
  );

  // RigidBody refs, keyed by a NAMESPACED string rather than a bare shape id.
  //
  // Two different kinds of body live in here — a group's compound body and an
  // individual shape's standalone body — and keying both on a number let them
  // alias. The old code resolved a grouped shape to `groupMembers[0].id`,
  // where `groupMembers` was every shape parented into the root *including*
  // motor-group driven members, which render their own standalone body. When a
  // driven member sorted first, the group body and that member's body were
  // handed the same ref, and `useRevoluteJoint(pivotRef, shapeRef, …)` then
  // received the same body for both anchors — a degenerate self-joint that
  // diverges no matter how correct the anchor offsets are. See
  // docs/bug-audit-2026-08.md, BUG-001.
  //
  // `group:` and `shape:` are disjoint namespaces, so that aliasing is now
  // unrepresentable rather than merely unlikely.
  const bodyRefs = useRef<Map<string, React.RefObject<any>>>(new Map());

  const refForKey = useCallback((key: string) => {
    if (!bodyRefs.current.has(key)) {
      bodyRefs.current.set(key, React.createRef());
    }
    return bodyRefs.current.get(key)!;
  }, []);

  /** The compound RigidBody for a root group. */
  const getGroupBodyRef = useCallback(
    (rootGroupId: number) => refForKey(`group:${rootGroupId}`),
    [refForKey],
  );

  /** The RigidBody a given shape's transform is actually controlled by. */
  const getBodyRef = useCallback(
    (id: number) => {
      const shape = shapes.find((s) => s.id === id);
      // A driven motor-group member always renders its own standalone
      // RigidBody (see unGroupedShapes below), even when it is parented into a
      // group — so it must resolve to its own ref, never the group's.
      const isDrivenMember = motorGroups.some(
        (mg) => mg.shapeIds.includes(id) && mg.pivotShapeId !== id,
      );
      if (shape?.parentId && !isDrivenMember) {
        return getGroupBodyRef(getRootGroupId(shape.parentId));
      }
      return refForKey(`shape:${id}`);
    },
    [shapes, motorGroups, getRootGroupId, getGroupBodyRef, refForKey],
  );

  // Map of wheel shape ID -> React ref of its (RigidBody-less) visual
  // group. Vehicle wheels are driven imperatively by RaycastVehicle, not by
  // their own physics body, so they need a plain Object3D ref rather than
  // the RigidBody refs bodyRefs/getBodyRef track.
  const wheelMeshRefs = useRef<Map<number, React.RefObject<THREE.Group | null>>>(new Map());
  const getWheelMeshRef = useCallback((id: number) => {
    if (!wheelMeshRefs.current.has(id)) {
      wheelMeshRefs.current.set(id, React.createRef<THREE.Group>());
    }
    return wheelMeshRefs.current.get(id)!;
  }, []);

  // Map of motor-group ID -> React ref of an invisible fixed RigidBody, for
  // custom motor groups whose pivot is a bare world-space point (mg.pivot)
  // rather than another shape (mg.pivotShapeId). A real Rapier joint needs
  // two actual bodies, so a point-only pivot needs something physical to
  // anchor to.
  const pivotAnchorRefs = useRef<Map<number, React.RefObject<any>>>(new Map());
  const getPivotAnchorRef = useCallback((motorGroupId: number) => {
    if (!pivotAnchorRefs.current.has(motorGroupId)) {
      pivotAnchorRefs.current.set(motorGroupId, React.createRef());
    }
    return pivotAnchorRefs.current.get(motorGroupId)!;
  }, []);

  const steerFollowerByShapeId = useMemo(() => {
    const map = new Map<
      number,
      { chassisId: number; steerable: boolean; rollable: boolean }
    >();
    const steerPivotIds = new Set<number>();

    motorGroups.forEach((mg) => {
      if (mg.vehicleRole !== "steer" || mg.pivotShapeId === undefined) return;
      mg.shapeIds.forEach((shapeId) => {
        if (shapeId === mg.pivotShapeId) return;
        map.set(shapeId, {
          chassisId: mg.pivotShapeId!,
          steerable: true,
          rollable: false,
        });
        steerPivotIds.add(shapeId);
      });
    });

    motorGroups.forEach((mg) => {
      if (mg.pivotShapeId === undefined || !steerPivotIds.has(mg.pivotShapeId))
        return;
      const steerGroup = map.get(mg.pivotShapeId);
      if (!steerGroup) return;
      mg.shapeIds.forEach((shapeId) => {
        if (shapeId === mg.pivotShapeId) return;
        map.set(shapeId, {
          chassisId: steerGroup.chassisId,
          steerable: true,
          rollable: mg.vehicleRole === "drive",
        });
      });
    });

    return map;
  }, [motorGroups]);


  const circuitControls = useMemo(() => deriveCircuitVehicleControls(circuitFrame), [circuitFrame]);

  const getCircuitDriveSpeedForChassis = useCallback((chassisId: number) => {
    let strongest: number | undefined;

    motorGroups.forEach((mg) => {
      if (mg.vehicleRole !== "drive" || mg.pivotShapeId !== chassisId) return;
      mg.shapeIds.forEach((shapeId) => {
        if (shapeId === mg.pivotShapeId) return;
        const wheelShape = shapes.find((shape) => shape.id === shapeId);
        const speed = getLinkedMotorSpeed(wheelShape, mg, circuitFrame);
        if (typeof speed !== "number") return;
        if (strongest === undefined || Math.abs(speed) > Math.abs(strongest)) {
          strongest = speed;
        }
      });
    });

    return strongest;
  }, [circuitFrame, motorGroups, shapes]);
  // Keyboard controls listener
  const keyboardControls = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
  });

  useEffect(() => {
    keyboardControls.current.forward = circuitControls.forward;
    keyboardControls.current.backward = circuitControls.backward;
    keyboardControls.current.left = circuitControls.left;
    keyboardControls.current.right = circuitControls.right;
    keyboardControls.current.brake = circuitControls.brake;
  }, [circuitControls, circuitFrame?.running]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || e.key === "ArrowUp")
        keyboardControls.current.forward = true;
      if (k === "s" || e.key === "ArrowDown")
        keyboardControls.current.backward = true;
      if (k === "a" || e.key === "ArrowLeft")
        keyboardControls.current.left = true;
      if (k === "d" || e.key === "ArrowRight")
        keyboardControls.current.right = true;
      if (e.key === " ") keyboardControls.current.brake = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || e.key === "ArrowUp")
        keyboardControls.current.forward = false;
      if (k === "s" || e.key === "ArrowDown")
        keyboardControls.current.backward = false;
      if (k === "a" || e.key === "ArrowLeft")
        keyboardControls.current.left = false;
      if (k === "d" || e.key === "ArrowRight")
        keyboardControls.current.right = false;
      if (e.key === " ") keyboardControls.current.brake = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // â”€â”€ Grabbing System (Pointer Drag) â”€â”€
  const [grabbedBody, setGrabbedBody] = useState<any | null>(null);
  const dragPlane = useMemo(() => new THREE.Plane(), []);
  const dragOffset = useMemo(() => new THREE.Vector3(), []);
  const grabbedStartType = useRef<number>(0);

  const handlePointerDown = (e: any, body: any) => {
    e.stopPropagation();
    if (!body) return;

    // Only dynamic bodies can actually be dragged — locked shapes render as
    // "fixed" bodies and steer-followers as kinematic, so grabbing either
    // would just disable orbit controls with no visible movement (or fight
    // with the steering controller's own per-frame updates).
    if (body.bodyType() !== 0) return;

    // Save body & original type (0: dynamic, 1: fixed, etc.)
    setGrabbedBody(body);
    grabbedStartType.current = body.bodyType();

    // Temporarily switch dynamic body to KinematicPositionBased (2) to move it cleanly
    if (grabbedStartType.current === 0) {
      body.setBodyType(2);
    }

    // Set dragging plane: default horizontal (XZ), Alt key lifts/lowers (Y)
    if (e.altKey) {
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      dragPlane.setFromNormalAndCoplanarPoint(
        camDir.clone().negate(),
        e.point,
      );
    } else {
      dragPlane.setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 1, 0),
        e.point,
      );
    }

    // Store cursor offset from object center
    const translation = body.translation();
    const objectCenter = new THREE.Vector3(
      translation.x,
      translation.y,
      translation.z,
    );
    dragOffset.copy(objectCenter).sub(e.point);

    gl.domElement.style.cursor = "grabbing";
  };

  useFrame(() => {
    if (!grabbedBody) return;
    raycaster.setFromCamera(pointer, camera);
    const hitPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
      const targetPos = hitPoint.clone().add(dragOffset);
      grabbedBody.setNextKinematicTranslation(targetPos);
    }
  });

  const handlePointerUp = () => {
    if (!grabbedBody) return;

    // Restore original body type (e.g. dynamic)
    if (grabbedStartType.current === 0) {
      grabbedBody.setBodyType(0);
      grabbedBody.wakeUp();
    }
    setGrabbedBody(null);
    gl.domElement.style.cursor = "default";
  };

  useEffect(() => {
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [grabbedBody]);

  // â”€â”€ GLTF Asset Loading â”€â”€
  const gltfUrls = useMemo(() => {
    const urls = new Set<string>();
    const collectUrls = (members: CustomMember[]) => {
      members.forEach((m) => {
        if (m.type === "glb" && m.url) urls.add(m.url);
        if (m.type === "custom" && m.customMembers) {
          collectUrls(m.customMembers);
        }
      });
    };
    shapes.forEach((s) => {
      if (s.type === "glb" && s.url) urls.add(s.url);
      if (s.type === "custom" && s.customMembers) {
        collectUrls(s.customMembers);
      }
    });
    return Array.from(urls);
  }, [shapes]);

  // Load and cache GLB assets
  const gltfs = useGLTF(gltfUrls);
  const gltfGeometryMap = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    if (gltfUrls.length === 0) return map;

    const results = Array.isArray(gltfs) ? gltfs : [gltfs];
    gltfUrls.forEach((url, i) => {
      const gltf = results[i];
      if (!gltf) return;

      const geoms: THREE.BufferGeometry[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((node: any) => {
        if (node.isMesh && node.geometry) {
          const cloned = node.geometry.clone();
          cloned.applyMatrix4(node.matrixWorld);
          geoms.push(cloned);
        }
      });
      if (geoms.length > 0) {
        try {
          const merged = mergeGeometries(geoms, false);
          if (merged) {
            merged.computeBoundingBox();
            const box = merged.boundingBox;
            if (box) {
              const size = new THREE.Vector3();
              box.getSize(size);
              const center = new THREE.Vector3();
              box.getCenter(center);
              const maxDim = Math.max(size.x, size.y, size.z);
              const scaleFactor = maxDim > 0 ? 1.0 / maxDim : 1.0;
              merged.translate(-center.x, -center.y, -center.z);
              merged.scale(scaleFactor, scaleFactor, scaleFactor);
            }
            map.set(url, merged);
          }
        } catch (e) {
          // See the matching catch in Canvas3D: a silent failure here leaves
          // the URL absent from the map, which VoxelizedShapeBody reads as
          // "not ready yet" and waits on forever (BUG-013). Log it so the
          // cause is visible; the loaded/failed distinction itself belongs
          // to BUG-013, which owns this map's contract.
          console.error(
            `[SimulationScene] failed to merge GLB geometry for "${url}" — this ` +
              `model will get no collider and stay kinematic:`,
            e,
          );
        }
      }
    });
    return map;
  }, [gltfUrls, gltfs]);

  // â”€â”€ Build Scene Elements â”€â”€
  const unGroupedShapes = useMemo(() => {
    return shapes.filter((s) => {
      // Skip BSP group containers — they are just group definitions, not geometry
      if (s.type === "group" && s.groupType === "boolean") return false;
      // Standalone if it has no parentId, OR if it is a wheel in a motorGroup (needs standalone physics)
      if (!s.parentId) return true;
      const isWheelOfMotorGroup = motorGroups.some(
        (mg) => mg.shapeIds.includes(s.id) && mg.pivotShapeId !== s.id,
      );
      return isWheelOfMotorGroup;
    });
  }, [shapes, motorGroups]);

  const groupMapping = useMemo(() => {
    const map = new Map<number, ShapeType[]>();
    shapes.forEach((s) => {
      if (s.parentId) {
        // Exclude if it is a wheel in a motorGroup (so it stays standalone)
        const isWheelOfMotorGroup = motorGroups.some(
          (mg) => mg.shapeIds.includes(s.id) && mg.pivotShapeId !== s.id,
        );
        if (isWheelOfMotorGroup) return;

        const rootId = getRootGroupId(s.parentId);
        if (!map.has(rootId)) map.set(rootId, []);
        map.get(rootId)!.push(s);
      }
    });
    return Array.from(map.entries());
  }, [shapes, motorGroups, getRootGroupId]);

  const getShapeWorldTransform = (s: ShapeType) => {
    let pos: [number, number, number] = [...s.position];
    let rot: [number, number, number] = [...s.rotation];

    if (s.parentId) {
      const g = groups.find((group) => group.id === s.parentId);
      if (g) {
        let pivot: [number, number, number] = [0, 0, 0];
        if (g.pivot) {
          pivot = [g.pivot[0], g.pivot[1], g.pivot[2]];
        } else {
          const members = shapes.filter((shape) => shape.parentId === g.id);
          if (members.length > 0) {
            pivot = [...members[0].position];
          }
        }

        const axis = g.jointAxis || "y";
        const rotDeg = g.jointRotation || 0;
        const groupEuler = new THREE.Euler(
          axis === "x" ? THREE.MathUtils.degToRad(rotDeg) : 0,
          axis === "y" ? THREE.MathUtils.degToRad(rotDeg) : 0,
          axis === "z" ? THREE.MathUtils.degToRad(rotDeg) : 0,
        );
        const qParent = new THREE.Quaternion().setFromEuler(groupEuler);

        const pivotVec = new THREE.Vector3(...pivot);
        const childPosVec = new THREE.Vector3(...s.position);
        const offset = childPosVec.clone().sub(pivotVec);
        offset.applyQuaternion(qParent);
        const worldPos = pivotVec.clone().add(offset);
        pos = [worldPos.x, worldPos.y, worldPos.z];

        const qChild = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...s.rotation),
        );
        const qWorld = qParent.clone().multiply(qChild);
        const eulerWorld = new THREE.Euler().setFromQuaternion(qWorld);
        rot = [eulerWorld.x, eulerWorld.y, eulerWorld.z];
      }
    }

    return { position: pos, rotation: rot };
  };

  // Memoize initial transforms of all shapes (prevents teleportation / resets on re-renders)
  const initialTransforms = useMemo(() => {
    const map = new Map<
      number,
      { position: [number, number, number]; rotation: [number, number, number] }
    >();
    shapes.forEach((s) => {
      map.set(s.id, getShapeWorldTransform(s));
    });
    return map;
  }, [shapes, groups]);

  // Memoize initial group origins and rotations (prevents teleportation / resets on re-renders)
  const initialGroupTransforms = useMemo(() => {
    const map = new Map<
      number,
      { position: [number, number, number]; rotation: [number, number, number] }
    >();
    groupMapping.forEach(([groupId, members]) => {
      const memberTransforms = members.map((m) => {
        return (
          initialTransforms.get(m.id) || {
            position: m.position,
            rotation: m.rotation,
          }
        );
      });

      const sumPos = memberTransforms.reduce(
        (acc, t) => [
          acc[0] + t.position[0],
          acc[1] + t.position[1],
          acc[2] + t.position[2],
        ],
        [0, 0, 0],
      );
      const groupOrigin: [number, number, number] = [
        sumPos[0] / members.length,
        sumPos[1] / members.length,
        sumPos[2] / members.length,
      ];

      // Identity rotation, NOT memberTransforms[0].rotation.
      //
      // The old value made the group's whole rest frame depend on which member
      // happened to sort first in the shapes array: reorder the array — via an
      // undo, a re-group, or a load from a different source — and every
      // member's local transform shifted with it, because they are all derived
      // relative to this frame. That is the same array-order dependence as
      // BUG-001, in a different function.
      //
      // The centroid is order-invariant and identity trivially is, so the frame
      // is now stable by construction. Nothing else has to change: local
      // rotations are computed as `qAnchorInv * qChild`, which with an identity
      // anchor collapses to `qChild` — each member simply carries its own world
      // rotation, which is what it had before for any group whose first member
      // was unrotated (including the demo car). See BUG-004.
      map.set(groupId, {
        position: groupOrigin,
        rotation: [0, 0, 0] as [number, number, number],
      });
    });
    return map;
  }, [groupMapping, initialTransforms]);

  // A vehicle/motor-group pivot shape is frequently just one member of a
  // multi-shape compound chassis — its own authored position is NOT the
  // actual RigidBody's world origin, which sits at initialGroupTransforms'
  // member-centroid (groupOrigin), the same reference every member's mesh
  // and collider is positioned relative to. Ungrouped (standalone) pivot
  // shapes have no such split — their own transform IS the RigidBody's
  // origin — so they still fall back to getShapeWorldTransform.
  //
  // INVARIANT for callers: this is safe wherever the consumer attaches to the
  // body this transform describes, because it returns exactly that body's
  // authored position/rotation. Both current callers satisfy it — the
  // RaycastVehicle wheel config, and CustomRevoluteMotor's anchor1, whose
  // pivotRef is getBodyRef(pivotShapeId) and therefore resolves to the very
  // group body this returns the transform of.
  //
  // An earlier revision of this comment claimed the function was safe only
  // "because it never feeds a live joint anchor". That was too narrow and had
  // already been overtaken: CustomRevoluteMotor does feed it to a joint anchor,
  // and that is fine, because the anchors are set once at joint creation and
  // never mutated afterwards (only configureMotorVelocity is called per frame).
  // What actually matters is frame agreement, not liveness — so check that,
  // not the call site's category, before reusing this. See BUG-003.
  const getChassisWorldTransform = (pivotShape: ShapeType) => {
    if (pivotShape.parentId) {
      const rootId = getRootGroupId(pivotShape.parentId);
      const groupTransform = initialGroupTransforms.get(rootId);
      if (groupTransform) return groupTransform;
    }
    return getShapeWorldTransform(pivotShape);
  };

  // Builds one RaycastVehicle wheel config per chassis that has any
  // vehicle-role ("drive" or "steer") motor group. Drive wheels come
  // directly from "drive" motor-group membership. Steering is trickier: the
  // motor-group data model only ever links a "steer" group's target
  // shape(s) (a decorative steering-knuckle shape in the demo car — see
  // KinematicSteerFollower, still used for its cosmetic rotation) to the
  // chassis, never to a specific wheel. There's no field that says "this
  // wheel is steered by this knuckle." We infer that association by
  // proximity: a steer-group target positioned near a drive wheel is
  // assumed to represent it, which matches how the demo car (and any
  // similarly-authored vehicle) actually places its knuckles right next to
  // the wheel they're meant to indicate.
  const vehicleConfigs = useMemo(() => {
    const chassisIds = new Set<number>();
    motorGroups.forEach((mg) => {
      if (
        (mg.vehicleRole === "drive" || mg.vehicleRole === "steer") &&
        mg.pivotShapeId !== undefined
      ) {
        chassisIds.add(mg.pivotShapeId);
      }
    });

    return Array.from(chassisIds)
      .map((chassisId) => {
        const chassisShape = shapes.find((s) => s.id === chassisId);
        if (!chassisShape) return null;

        const steerTargets = motorGroups
          .filter((mg) => mg.vehicleRole === "steer" && mg.pivotShapeId === chassisId)
          .flatMap((mg) => mg.shapeIds.filter((id) => id !== mg.pivotShapeId))
          .map((id) => shapes.find((s) => s.id === id))
          .filter((s): s is ShapeType => !!s);

        const driveWheelIds = new Set<number>();
        motorGroups.forEach((mg) => {
          if (mg.vehicleRole === "drive" && mg.pivotShapeId === chassisId) {
            mg.shapeIds.forEach((id) => {
              if (id !== chassisId) driveWheelIds.add(id);
            });
          }
        });
        if (driveWheelIds.size === 0) return null;

        const chassisTransform = getChassisWorldTransform(chassisShape);
        const qChassisInv = new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(...chassisTransform.rotation))
          .invert();
        const chassisWidth = Math.max(0.01, chassisShape.scale[0]);

        const wheels: VehicleWheelConfig[] = Array.from(driveWheelIds).map((wheelId) => {
          const wheelShape = shapes.find((s) => s.id === wheelId)!;
          const wheelTransform = getShapeWorldTransform(wheelShape);

          const offsetWorld = new THREE.Vector3(
            wheelTransform.position[0] - chassisTransform.position[0],
            wheelTransform.position[1] - chassisTransform.position[1],
            wheelTransform.position[2] - chassisTransform.position[2],
          ).applyQuaternion(qChassisInv);

          const radius = Math.max(wheelShape.scale[0], wheelShape.scale[2]) * 0.5;

          const driveGroup = motorGroups.find(
            (mg) =>
              mg.vehicleRole === "drive" &&
              mg.pivotShapeId === chassisId &&
              mg.shapeIds.includes(wheelId),
          );
          const axleCs: [number, number, number] =
            driveGroup?.jointAxis === "z"
              ? [0, 0, 1]
              : driveGroup?.jointAxis === "y"
                ? [0, 1, 0]
                : [1, 0, 0];

          const isSteer = steerTargets.some((target) => {
            const dx = target.position[0] - wheelShape.position[0];
            const dy = target.position[1] - wheelShape.position[1];
            const dz = target.position[2] - wheelShape.position[2];
            return Math.sqrt(dx * dx + dy * dy + dz * dz) < chassisWidth * 0.5;
          });

          return {
            shapeId: wheelId,
            meshRef: getWheelMeshRef(wheelId),
            chassisConnectionCs: [offsetWorld.x, offsetWorld.y, offsetWorld.z],
            axleCs,
            radius,
            isDrive: true,
            isSteer,
          };
        });

        // Force scale, derived from this vehicle's OWN wheels rather than a
        // scene-wide guess. The previous version matched `id === 1002` or any
        // shape whose name merely contained "wheel", so naming a decorative
        // part "Wheel guard" silently re-scaled every drive/brake force by the
        // cube of its X scale — and a scene without either fell back to 1.0
        // and badly under-powered a scaled-up vehicle. Mean wheel diameter is
        // the quantity the VEHICLE_* constants were actually calibrated
        // against. See BUG-005.
        const meanWheelDiameter =
          (wheels.reduce((sum, w) => sum + w.radius * 2, 0) / wheels.length) || REFERENCE_WHEEL_DIAMETER;
        const scaleMultiplier = Math.max(0.05, meanWheelDiameter / REFERENCE_WHEEL_DIAMETER);

        return { chassisId, wheels, scaleMultiplier };
      })
      .filter(
        (v): v is { chassisId: number; wheels: VehicleWheelConfig[]; scaleMultiplier: number } =>
          v !== null,
      );
  }, [shapes, motorGroups, getWheelMeshRef]);

  const vehicleWheelShapeIds = useMemo(() => {
    const ids = new Set<number>();
    vehicleConfigs.forEach((v) => v.wheels.forEach((w) => ids.add(w.shapeId)));
    return ids;
  }, [vehicleConfigs]);

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={[50, 50, 50]}
        fov={50}
        near={0.01}
        far={20000}
      />
      <ambientLight intensity={1.5} />
      <directionalLight
        castShadow
        position={[20, 40, 20]}
        intensity={2.5}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
      />
      <OrbitControls makeDefault enabled={!grabbedBody} minDistance={5} maxDistance={1000} />
      <GizmoHelper alignment="bottom-left" margin={[60, 60]}>
        <CleanAxisMap />
      </GizmoHelper>

      <Physics
        gravity={gravity}
        paused={!isPlaying}
        debug={debugOutlines}
        timeStep={1 / 60}
      >
        {/* Ground Floor */}
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider
            args={[150, 0.5, 150]}
            position={[0, -0.5, 0]}
            friction={0.9}
            restitution={0.1}
          />
          <mesh position={[0, -0.5, 0]} receiveShadow>
            <boxGeometry args={[300, 1, 300]} />
            <meshStandardMaterial color="#1e293b" rough-metal={[0.8, 0.2]} />
          </mesh>
          <gridHelper
            args={[300, 150, "#475569", "#334155"]}
            position={[0, 0.01, 0]}
          />
        </RigidBody>

        {/* â”€â”€ Standalone Shapes â”€â”€ */}
        {unGroupedShapes.map((s) => {
          // Distinguish vehicle chassis from custom motor pivot — only vehicle gets constraints
          const isVehicleChassis = motorGroups.some(
            (mg) =>
              mg.pivotShapeId === s.id &&
              (mg.vehicleRole === "drive" || mg.vehicleRole === "steer"),
          );
          const isCustomMotorPivot = motorGroups.some(
            (mg) =>
              mg.pivotShapeId === s.id &&
              mg.vehicleRole !== "drive" &&
              mg.vehicleRole !== "steer",
          );
          const isChassis = isVehicleChassis; // only vehicle chassis gets special treatment
          const isWheel = motorGroups.some(
            (mg) => mg.shapeIds.includes(s.id) && mg.pivotShapeId !== s.id,
          );
          const isCustomMotorWheel = motorGroups.some(
            (mg) =>
              mg.shapeIds.includes(s.id) &&
              mg.pivotShapeId !== s.id &&
              mg.vehicleRole !== "drive" &&
              mg.vehicleRole !== "steer",
          );

          const steerFollower = steerFollowerByShapeId.get(s.id);

          // Steer wheels are kinematic — driven directly each frame, no joint oscillation
          const type =
            s.isLocked && !isChassis && !isCustomMotorPivot && !isWheel
              ? "fixed"
              : steerFollower
                ? "kinematicPosition"
                : "dynamic";
          const ref = getBodyRef(s.id);
          const worldTransform = initialTransforms.get(s.id)!;

          let rbRotation = worldTransform.rotation;
          let relativeRotation: [number, number, number] = [0, 0, 0];

          if (isWheel && !steerFollower) {
            const motorGroup = motorGroups.find(
              (mg) => mg.shapeIds.includes(s.id) && mg.pivotShapeId !== s.id,
            );
            const chassisId = motorGroup?.pivotShapeId;
            const chassisShape =
              chassisId !== undefined
                ? shapes.find((cs) => cs.id === chassisId)
                : undefined;
            if (chassisShape) {
              const chassisTransform = initialTransforms.get(chassisShape.id)!;
              rbRotation = chassisTransform.rotation;

              const qChassis = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(...chassisTransform.rotation),
              );
              const qWheel = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(...worldTransform.rotation),
              );
              const qRelative = qChassis.clone().invert().multiply(qWheel);
              const eulerRelative = new THREE.Euler().setFromQuaternion(
                qRelative,
              );
              relativeRotation = [
                eulerRelative.x,
                eulerRelative.y,
                eulerRelative.z,
              ];
            }
          }

          // Chassis: high angular damping prevents toppling.
          // Wheels: LOW angular damping so they spin freely (high values fight joint = wobble).
          // Linear damping: just enough to stop infinite sliding.
          const linearDamp = isChassis
            ? 1.0
            : isCustomMotorPivot
              ? 0.5
              : isWheel
                ? 0.1
                : 0.5;
          const angularDamp = isChassis
            ? 5.0
            : isCustomMotorPivot
              ? 0.8
              : isCustomMotorWheel
                ? 0.3
                : isWheel
                  ? 0.05
                  : 0.8;

          const cType = getAutoColliderType(s.type, type === "fixed");
          const friction = s.friction !== undefined ? s.friction : 0.6;
          const restitution = s.restitution !== undefined ? s.restitution : 0.2;
          const shapeMass = resolveShapeMass(s);

          const meshContent =
            s.type === "glb" && s.url ? (
              <SuspendedGlbShapeMesh shape={s} castShadow receiveShadow />
            ) : s.type === "custom" && s.customMembers ? (
              <CustomShapeMesh
                shape={s}
                evaluator={evaluator}
                simulationFrame={null}
                castShadow
                receiveShadow
                gltfGeometryMap={gltfGeometryMap}
              />
            ) : (
              <mesh castShadow receiveShadow>
                <PrimitiveGeometry type={s.type} />
                <ShapeMaterial shape={s} simulationData={undefined} />
              </mesh>
            );

          const shapeEnabledRotations: [boolean, boolean, boolean] = isChassis
            ? [false, true, false]
            : s.fixedRotation
              ? [false, false, false]
              : [true, true, true];

          // Hollow custom/CSG or concave-GLB shapes that will actually be
          // simulated as dynamic get the voxel-compound-collider path
          // instead of the single hull/cuboid this else-branch below would
          // otherwise build — that hull would fill their hole in exactly
          // like the cogwheel/torus bug this session started from. Locked
          // ("fixed") shapes and steer-follower kinematics are excluded:
          // a static body already gets an exact TrimeshCollider elsewhere,
          // and a steer follower is driven imperatively every frame by
          // KinematicSteerFollower, never meant to go dynamic at all — both
          // would conflict with this component's own kinematic->dynamic
          // handoff.
          if (
            type === "dynamic" &&
            !steerFollower &&
            shouldVoxelizeShape(s, gltfGeometryMap)
          ) {
            return (
              <VoxelizedShapeBody
                key={s.id}
                shape={s}
                position={worldTransform.position}
                rotation={rbRotation}
                linearDamping={linearDamp}
                angularDamping={angularDamp}
                friction={friction}
                restitution={restitution}
                mass={shapeMass}
                enabledRotations={shapeEnabledRotations}
                meshContent={meshContent}
                meshScale={s.scale}
                meshRotation={relativeRotation}
                evaluator={evaluator}
                gltfGeometryMap={gltfGeometryMap}
                bodyRef={ref}
                onPointerDown={(e) => handlePointerDown(e, ref.current)}
                onPointerOver={() => {
                  if (!grabbedBody) gl.domElement.style.cursor = "grab";
                }}
                onPointerOut={() => {
                  if (!grabbedBody) gl.domElement.style.cursor = "default";
                }}
              />
            );
          }

          // Vehicle wheels (drive/steer motor-group members, as opposed to
          // custom-motor gear/turntable "wheels") get no RigidBody or
          // collider of their own at all — RaycastVehicle drives them via
          // Rapier's raycast vehicle controller, which applies suspension
          // and tire-friction forces straight to the chassis body. This
          // group only needs a plain, imperatively-driven visual transform.
          if (vehicleWheelShapeIds.has(s.id)) {
            const wheelMeshRef = getWheelMeshRef(s.id);
            return (
              <group
                key={s.id}
                ref={wheelMeshRef}
                position={worldTransform.position}
                rotation={worldTransform.rotation}
              >
                {/* relativeRotation is the wheel's own fixed tilt relative
                to the chassis (e.g. a cylinder rotated 90° about Z to lie
                on its side) — already computed above by the isWheel block.
                Applied here on the INNER group only; the OUTER group above
                gets overwritten every frame by RaycastVehicle with the live
                chassis+steer+roll orientation, so this inner tilt has to
                stay independent of that or the wheel renders upright. */}
                <group scale={s.scale} rotation={relativeRotation}>
                  {meshContent}
                </group>

                {/* Wheels have no real collider (see comment above) so
                Rapier's own debug renderer (Physics debug={debugOutlines})
                has nothing to draw for them. This ring is a stand-in: not a
                real collider outline, just a visual indicator of the
                raycast vehicle's wheel radius, oriented the same way the
                wheel mesh is (relativeRotation) so it sits flush against
                the tire regardless of which local axis is the axle. */}
                {debugOutlines && (
                  <group rotation={relativeRotation}>
                    <mesh rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry
                        args={[
                          Math.max(s.scale[0], s.scale[2]) * 0.5,
                          Math.max(s.scale[0], s.scale[2]) * 0.015,
                          8,
                          32,
                        ]}
                      />
                      <meshBasicMaterial color="#ff00ff" wireframe />
                    </mesh>
                  </group>
                )}
              </group>
            );
          }

          return (
            <RigidBody
              key={s.id}
              ref={ref}
              type={type}
              position={worldTransform.position}
              rotation={rbRotation}
              colliders={false}
              linearDamping={linearDamp}
              angularDamping={angularDamp}
              friction={friction}
              restitution={restitution}
              // NO `mass` prop: it is a no-op on <RigidBody> in
              // @react-three/rapier v2.2.0 — verified in the library source,
              // where rigidBodyDescFromOptions applies only type/canSleep,
              // mutableRigidBodyOptions has no mass handler, and
              // cleanRigidBodyPropsForCollider strips `mass` before child
              // colliders inherit rigid-body props. This body's mass comes
              // entirely from the MemberCollider below, which sets it per
              // collider. Setting it here too only implied a control that
              // does not exist. See BUG-006.
              // Continuous collision detection — a motor spinning this body
              // fast enough can move a thin collider wall past a contact
              // surface within a single discrete timestep even when the
              // wall geometry itself is fully closed (correct voxelization
              // isn't enough on its own at high angular velocity); CCD
              // sweeps the motion instead of just sampling start/end poses.
              ccd={type === "dynamic"}
              // A vehicle chassis must never sleep. Rapier's raycast vehicle
              // controller applies its engine/brake/steer forces directly and
              // does NOT wake the body it drives, so a chassis that dozes off
              // while parked silently swallows every newton afterwards — the
              // car simply stops responding. Worse, the discarded velocity
              // still accumulates on the sleeping body without ever being
              // integrated or damped, which is what drove the wheel meshes to
              // spin faster and faster over a stationary car.
              //
              // Prevention rather than recovery: waking on input would have to
              // also discard that pent-up velocity or the car launches. The
              // cost is one non-sleeping body per vehicle. See BUG-054.
              canSleep={!isChassis}
              // Chassis: lock pitch (X) and roll (Z) — only yaw (Y) allowed.
              // This is the biggest anti-wobble measure: chassis cannot tip.
              // Wheels: allow full rotation so the joint motor can work correctly.
              enabledRotations={shapeEnabledRotations}
            >
              {/* Visual Mesh */}
              <group
                onPointerDown={(e) => handlePointerDown(e, ref.current)}
                onPointerOver={() => {
                  if (!grabbedBody) gl.domElement.style.cursor = "grab";
                }}
                onPointerOut={() => {
                  if (!grabbedBody) gl.domElement.style.cursor = "default";
                }}
                scale={s.scale}
                rotation={relativeRotation}
              >
                {meshContent}
              </group>

              {/* Collider */}
              {!s.collisionDisabled && !steerFollower && !s.isHole && (
                <MemberCollider
                  shape={s}
                  position={[0, 0, 0]}
                  rotation={relativeRotation}
                  isDynamic={type !== "fixed"}
                  evaluator={evaluator}
                  gltfGeometryMap={gltfGeometryMap}
                  mass={shapeMass}
                  friction={friction}
                  restitution={restitution}
                  keyPrefix={`collider-${s.id}`}
                />
              )}
            </RigidBody>
          );
        })}

        {/* â”€â”€ Grouped / Compound Shapes â”€â”€ */}
        {groupMapping.map(([groupId, members]) => {
          const isVehicleChassis = motorGroups.some(
            (mg) =>
              mg.pivotShapeId === members[0].id &&
              (mg.vehicleRole === "drive" || mg.vehicleRole === "steer"),
          );
          const isChassis = isVehicleChassis;
          const isLocked = members.some((m) => m.isLocked);
          const type = isLocked && !isChassis ? "fixed" : "dynamic";
          // Keyed on the group itself, not on whichever member sorts first.
          // `groupId` here is already the root id (groupMapping keys on
          // getRootGroupId), so this is the same ref any grouped non-driven
          // member resolves to via getBodyRef — by construction now, rather
          // than by the two happening to agree on an array index (BUG-001).
          const groupRef = getGroupBodyRef(groupId);

          const groupTransform = initialGroupTransforms.get(groupId)!;
          const memberTransforms = members.map(
            (m) => initialTransforms.get(m.id)!,
          );

          const groupOrigin = groupTransform.position;
          const anchorRot = groupTransform.rotation;
          const qAnchor = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...anchorRot),
          );
          const qAnchorInv = qAnchor.clone().invert();

          const friction =
            members[0].friction !== undefined ? members[0].friction : 0.6;
          const restitution =
            members[0].restitution !== undefined ? members[0].restitution : 0.2;
          // (The group's total mass used to be summed here and passed to
          // <RigidBody mass>. That prop is a no-op — see BUG-006 — and the
          // real mass is the sum of the per-member collider masses set below,
          // which comes to the same figure. Removed rather than kept unused.)

          return (
            <RigidBody
              key={groupId}
              ref={groupRef}
              type={type}
              position={groupOrigin}
              // anchorRot, not memberTransforms[0].rotation — the body's
              // rotation must be the same frame every member's local transform
              // is derived against, or the two disagree (BUG-004).
              rotation={anchorRot}
              colliders={false}
              linearDamping={isChassis ? 1.0 : 0.8}
              angularDamping={isChassis ? 5.0 : 1.0}
              friction={friction}
              restitution={restitution}
              // No `mass` prop — see BUG-006 note on the standalone body
              // above. The group's mass is the sum of its members' collider
              // masses, each set on its own MemberCollider below, which is
              // exactly `totalMass` by construction.
              ccd={type === "dynamic"}
              // See the standalone body above: a vehicle chassis that sleeps
              // stops responding to the raycast controller entirely (BUG-054).
              // The demo car's chassis is a compound group, so this is the
              // path that actually matters for it.
              canSleep={!isChassis}
              enabledRotations={
                isChassis ? [false, true, false] : [true, true, true]
              }
            >
              {/* Visual meshes & Colliders — rendered directly per member */}
              <group
                onPointerDown={(e) => handlePointerDown(e, groupRef.current)}
                onPointerOver={() => {
                  if (!grabbedBody) gl.domElement.style.cursor = "grab";
                }}
                onPointerOut={() => {
                  if (!grabbedBody) gl.domElement.style.cursor = "default";
                }}
              >
                {members.some((m) => m.groupType === "boolean") ? (
                  // BSP / CSG group — render combined CSG result via CSGGroup,
                  // which handles MeshCollider internally (keyed by depsKey)
                  <CSGGroup
                    members={members}
                    selectedIds={[]}
                    evaluator={evaluator}
                    onPointerDown={() => {}}
                    isPhysics
                    isStatic={type === "fixed"}
                    anchor={groupOrigin}
                    anchorRotation={anchorRot}
                    simulationFrame={null}
                    gltfGeometryMap={gltfGeometryMap}
                    friction={friction}
                    restitution={restitution}
                  />
                ) : (
                  members.map((m, idx) => {
                    const t = memberTransforms[idx];
                    const posDiff = new THREE.Vector3(
                      t.position[0] - groupOrigin[0],
                      t.position[1] - groupOrigin[1],
                      t.position[2] - groupOrigin[2],
                    );
                    const localPosVec = posDiff
                      .clone()
                      .applyQuaternion(qAnchorInv);
                    const qChild = new THREE.Quaternion().setFromEuler(
                      new THREE.Euler(...t.rotation),
                    );
                    const qLocal = qAnchorInv.clone().multiply(qChild);
                    const eulerLocal = new THREE.Euler().setFromQuaternion(
                      qLocal,
                    );
                    const localPos: [number, number, number] = [
                      localPosVec.x,
                      localPosVec.y,
                      localPosVec.z,
                    ];
                    const localRot: [number, number, number] = [
                      eulerLocal.x,
                      eulerLocal.y,
                      eulerLocal.z,
                    ];

                    const memberMass = resolveShapeMass(m);

                    const meshContent = (
                      m.type === "glb" && m.url ? (
                        <SuspendedGlbShapeMesh shape={m} castShadow receiveShadow />
                      ) : m.type === "custom" && m.customMembers ? (
                        <CustomShapeMesh
                          shape={m}
                          evaluator={evaluator}
                          simulationFrame={null}
                          castShadow
                          receiveShadow
                          gltfGeometryMap={gltfGeometryMap}
                        />
                      ) : (
                        <mesh castShadow receiveShadow>
                          <PrimitiveGeometry type={m.type} />
                          <ShapeMaterial shape={m} simulationData={undefined} />
                        </mesh>
                      )
                    );

                    return (
                      <React.Fragment key={m.id}>
                        {/* Visual Mesh */}
                        <group
                          position={localPos}
                          rotation={localRot}
                          scale={m.scale}
                        >
                          {meshContent}
                        </group>

                        {/* Physics Collider */}
                        {!m.isHole && !m.collisionDisabled && (
                          <MemberCollider
                            shape={m}
                            position={localPos}
                            rotation={localRot}
                            isDynamic={type !== "fixed"}
                            evaluator={evaluator}
                            gltfGeometryMap={gltfGeometryMap}
                            mass={memberMass}
                            friction={friction}
                            restitution={restitution}
                            keyPrefix={`mcollider-${m.id}`}
                          />
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </group>
            </RigidBody>
          );
        })}

        {/* ── Vehicle Wheels (raycast suspension + friction, real steering) ── */}
        {vehicleConfigs.map(({ chassisId, wheels, scaleMultiplier }) => (
          <RaycastVehicle
            key={`vehicle-${chassisId}`}
            chassisRef={getBodyRef(chassisId)}
            wheels={wheels}
            keyboardControls={keyboardControls}
            circuitDriveSpeed={getCircuitDriveSpeedForChassis(chassisId)}
            // Per-vehicle now, not scene-wide — two vehicles of different
            // sizes in one scene each get their own force scale (BUG-005).
            scaleMultiplier={scaleMultiplier}
          />
        ))}

        {/* ———— Custom Motor pivot anchors ————
        Invisible fixed bodies for custom "motor" groups whose pivot is a
        bare world-space point (mg.pivot) rather than another shape — a real
        joint needs two actual bodies, so a point-only pivot needs something
        physical to anchor to. */}
        {motorGroups
          .filter(
            (mg) =>
              mg.vehicleRole !== "drive" &&
              mg.vehicleRole !== "steer" &&
              (mg.motionType || "motor") === "motor" &&
              mg.pivotShapeId === undefined &&
              mg.pivot !== undefined,
          )
          .map((mg) => (
            <RigidBody
              key={`custom-motor-anchor-${mg.id}`}
              ref={getPivotAnchorRef(mg.id)}
              type="fixed"
              position={mg.pivot}
              colliders={false}
            />
          ))}

        {/* ———— Custom Motors (vehicleRole = none/undefined) ———— */}
        {motorGroups
          .filter(
            (mg) => mg.vehicleRole !== "drive" && mg.vehicleRole !== "steer",
          )
          .map((mg) => {
            const speed: [number, number, number] = customMotorSpeeds?.get(
              mg.id,
            ) || [0, 0, 0];
            const axis: [number, number, number] =
              mg.jointAxis === "x"
                ? [1, 0, 0]
                : mg.jointAxis === "z"
                  ? [0, 0, 1]
                  : [0, 1, 0];

            const motionType = mg.motionType || "motor";
            const hasPivot = mg.pivotShapeId !== undefined || mg.pivot !== undefined;

            // Single-axis rotational motors with a configured pivot get a
            // real, pivot-anchored revolute joint (CustomRevoluteMotor) so
            // the shape actually orbits its pivot and respects
            // minLimit/maxLimit, matching what the CAD editor's
            // kinematic-mode preview (KinematicNode) shows — instead of
            // spinning in place around its own origin with limits silently
            // ignored, which is what this used to do unconditionally.
            // "linear" and "xyz_rotation" stay on the old direct-body
            // velocity path below: both are genuinely free 3-axis motion in
            // the editor too (MotionControlSection.tsx's driveXYZ drives
            // x/y/z independently), which doesn't fit a Revolute/Prismatic
            // joint (each only 1 free DOF) — Rapier's generic multi-axis
            // joint could represent it, but isn't exposed by
            // @react-three/rapier's hooks, so jointifying those is a
            // separate follow-up, not attempted here. A "motor" group with
            // no pivot configured at all also falls through to the old
            // path below (nothing to anchor a joint to).
            if (motionType === "motor" && hasPivot) {
              const pivotShape =
                mg.pivotShapeId !== undefined
                  ? shapes.find((s) => s.id === mg.pivotShapeId)
                  : undefined;

              if (pivotShape || mg.pivot) {
                const pivotRef =
                  mg.pivotShapeId !== undefined
                    ? getBodyRef(mg.pivotShapeId)
                    : getPivotAnchorRef(mg.id);
                const pivotTransform = pivotShape
                  ? getChassisWorldTransform(pivotShape)
                  : {
                      position: mg.pivot!,
                      rotation: [0, 0, 0] as [number, number, number],
                    };
                const qPivotInv = new THREE.Quaternion()
                  .setFromEuler(new THREE.Euler(...pivotTransform.rotation))
                  .invert();
                const limits: [number, number] | undefined =
                  mg.minLimit !== undefined && mg.maxLimit !== undefined
                    ? [
                        THREE.MathUtils.degToRad(mg.minLimit),
                        THREE.MathUtils.degToRad(mg.maxLimit),
                      ]
                    : undefined;

                // A shape that IS its own configured pivot (spin the shape
                // in place around its own center — a common, valid setup,
                // e.g. a turntable or fan) has no second body to joint
                // against; jointing it to itself is meaningless. Route
                // those through the direct-angular-velocity spinner instead
                // (exactly the physically-correct model for "rotate around
                // your own origin"), and only joint-drive shapes distinct
                // from the pivot. Filtering pivotShapeId out of shapeIds
                // without this split silently dropped the shape from
                // rendering *any* driver at all whenever a motor's pivot
                // was set to the shape itself.
                const jointDrivenIds = mg.shapeIds.filter(
                  (id) => id !== mg.pivotShapeId,
                );
                const selfPivotIds = mg.shapeIds.filter(
                  (id) => id === mg.pivotShapeId,
                );

                return (
                  <React.Fragment key={`custom-motor-group-${mg.id}`}>
                    {jointDrivenIds.map((shapeId) => {
                      const shape = shapes.find((s) => s.id === shapeId);
                      if (!shape) return null;
                      const shapeTransform = getShapeWorldTransform(shape);
                      const localOffset = new THREE.Vector3(
                        shapeTransform.position[0] - pivotTransform.position[0],
                        shapeTransform.position[1] - pivotTransform.position[1],
                        shapeTransform.position[2] - pivotTransform.position[2],
                      ).applyQuaternion(qPivotInv);

                      return (
                        <CustomRevoluteMotor
                          key={`custom-motor-${mg.id}-${shapeId}`}
                          pivotRef={pivotRef}
                          shapeRef={getBodyRef(shapeId)}
                          anchor1={[localOffset.x, localOffset.y, localOffset.z]}
                          anchor2={[0, 0, 0]}
                          axis={axis}
                          limits={limits}
                          speed={speed[0]}
                          // Scaled by the DRIVEN SHAPE's own size, which is
                          // what CUSTOM_MOTOR_TORQUE_BASE's comment always
                          // claimed. It previously used the scene-wide,
                          // wheel-derived scaleMultiplier — a number with no
                          // meaning for a custom motor, and one that fell back
                          // to 1.0 in any scene without a vehicle. See BUG-005.
                          torqueScale={Math.pow(
                            Math.max(
                              0.05,
                              Math.max(...shape.scale) / REFERENCE_WHEEL_DIAMETER,
                            ),
                            3,
                          )}
                        />
                      );
                    })}
                    {selfPivotIds.map((shapeId) => (
                      <CustomMotorDirectSpinner
                        key={`custom-spin-self-${mg.id}-${shapeId}`}
                        bodyRef={getBodyRef(shapeId)}
                        axis={axis}
                        speed={speed}
                        motionType={mg.motionType}
                      />
                    ))}
                  </React.Fragment>
                );
              }
            }

            // Fallback: no pivot configured, or a motion type that isn't a
            // clean single-axis joint — apply velocity directly to the
            // shape's own body, same as before.
            return mg.shapeIds.map((shapeId) => (
              <CustomMotorDirectSpinner
                key={`custom-spin-${mg.id}-${shapeId}`}
                bodyRef={getBodyRef(shapeId)}
                axis={axis}
                speed={speed}
                motionType={mg.motionType}
              />
            ));
          })}

        {Array.from(steerFollowerByShapeId.entries()).map(
          ([shapeId, follower]) => {
            const shape = shapes.find((s) => s.id === shapeId);
            const chassisShape = shapes.find(
              (s) => s.id === follower.chassisId,
            );
            if (!shape || !chassisShape) return null;

            const shapeTransform = getShapeWorldTransform(shape);
            const chassisTransform = getShapeWorldTransform(chassisShape);
            const qChassis = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(...chassisTransform.rotation),
            );
            const qShape = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(...shapeTransform.rotation),
            );
            const qRel = qChassis.clone().invert().multiply(qShape);
            const eulerRel = new THREE.Euler().setFromQuaternion(qRel);
            const offsetWorld = new THREE.Vector3(
              shapeTransform.position[0] - chassisTransform.position[0],
              shapeTransform.position[1] - chassisTransform.position[1],
              shapeTransform.position[2] - chassisTransform.position[2],
            );
            const localOffset = offsetWorld
              .clone()
              .applyQuaternion(qChassis.clone().invert());
            const wheelRadius = Math.max(shape.scale[0], shape.scale[2]) * 0.5;

            return (
              <KinematicSteerFollower
                key={`steer-follower-${shapeId}`}
                chassisRef={getBodyRef(follower.chassisId)}
                wheelRef={getBodyRef(shapeId)}
                localOffset={[localOffset.x, localOffset.y, localOffset.z]}
                baseRotation={[eulerRel.x, eulerRel.y, eulerRel.z]}
                wheelRadius={wheelRadius}
                steerable={follower.steerable}
                rollable={follower.rollable}
                keyboardControls={keyboardControls}
              />
            );
          },
        )}

      </Physics>
    </>
  );
}






