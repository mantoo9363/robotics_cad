// src/lib/motionController.ts

export type MotionType = "motor" | "xyz_rotation" | "linear";

export type MotionSignal = {
  targetId: string;
  type: MotionType;
  values: number[]; // degrees for rotation, units for linear
  duration?: number;
};

export type MotionSignalFrame = {
  tick: number;
  timestamp: number;
  signals: MotionSignal[];
};

export type MotionState = {
  type: MotionType;
  values: number[];
};

type MotionTarget = {
  current: number[];
  target: number[];
  type: MotionType;
};

export class MotionController {
  private targets = new Map<string, MotionTarget>();

  /** Push a new signal frame */
  pushSignals(frame: MotionSignalFrame): void {
    for (const signal of frame.signals) {
      this.updateTarget(signal.targetId, signal.type, signal.values);
    }
  }

  /** Manual override (from UI sliders) */
  setManual(channelId: string, type: MotionType, values: number[]): void {
    this.updateTarget(channelId, type, values);
  }

  private updateTarget(channelId: string, type: MotionType, values: number[]) {
    const limitedValues = values.map((val) => {
      // Linear motion is bounded; rotation stays unbounded so DC motors can spin continuously.
      if (type === "linear") {
        return Math.max(-100, Math.min(100, val));
      }
      return val;
    });

    const existing = this.targets.get(channelId);
    if (!existing || existing.type !== type) {
      this.targets.set(channelId, {
        current: [...limitedValues], // snap immediately if new
        target: [...limitedValues],
        type,
      });
    } else {
      existing.target = [...limitedValues];
    }
  }

  /** Called from useFrame — interpolates and returns current state */
  getState(channelId: string, dt: number): MotionState | null {
    const target = this.targets.get(channelId);
    if (!target) return null;

    // Simple lerp for smooth interpolation
    // Lerp factor (e.g., 10 means it moves 10% of the remaining distance per frame at 60fps)
    // Using a delta-time scaled lerp for frame-rate independence:
    const lerpFactor = 1.0 - Math.exp(-15 * dt);

    for (let i = 0; i < target.current.length; i++) {
      if (Math.abs(target.target[i] - target.current[i]) > 0.001) {
        target.current[i] += (target.target[i] - target.current[i]) * lerpFactor;
      } else {
        target.current[i] = target.target[i]; // snap if close enough
      }
    }

    return {
      type: target.type,
      values: [...target.current],
    };
  }
}
