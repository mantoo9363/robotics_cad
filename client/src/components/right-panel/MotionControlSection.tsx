import React, { useState, useEffect } from "react";
import type { ShapeType, GroupType, MotorGroup } from "../../App";
import type { MotionController, MotionType } from "../../lib/motionController";

// ── Motor Movement Block (slider per motor group) ────────────────────────────
function MotorMovementBlock({
  mg,
  motionController,
  updateMotorGroupMotion,
}: {
  mg: MotorGroup;
  motionController: MotionController;
  updateMotorGroupMotion: (motorGroupId: number, channelId?: string, type?: MotionType, inverted?: boolean, vehicleRole?: "drive" | "steer" | "none") => void;
}) {
  // Seed local slider state from the MotionController (an external mutable
  // store) for a given channel.
  const readChannelSeed = (channelId: string | undefined) => {
    if (channelId) {
      const ms = motionController.getState(channelId, 0);
      if (ms && (ms.type === "xyz_rotation" || ms.type === "linear") && ms.values) {
        return {
          rot: 0,
          xyz: { x: ms.values[0] || 0, y: ms.values[2] || 0, z: ms.values[1] || 0 },
        };
      }
      if (ms && ms.type === "motor" && ms.values && ms.values.length > 0) {
        return { rot: Math.round(ms.values[0]), xyz: { x: 0, y: 0, z: 0 } };
      }
    }
    return { rot: 0, xyz: { x: 0, y: 0, z: 0 } };
  };

  const seed = readChannelSeed(mg.motionChannelId);
  const [localChannel, setLocalChannel] = useState(mg.motionChannelId || "");
  const [sliderVal, setSliderVal] = useState(seed.rot);
  // XYZ slider positions. State, not a ref: these drive the controlled
  // <input value=…> below, and React 19 rejects reading a ref during render.
  const [xyzVals, setXyzVals] = useState<{ x: number; y: number; z: number }>(
    seed.xyz,
  );

  // Re-seed local state when this block starts pointing at a different motor
  // channel. Adjusting state *while rendering* (a prev-value guard) rather
  // than in an effect: React re-renders immediately with no extra commit.
  const [prevChannel, setPrevChannel] = useState(mg.motionChannelId);
  if (prevChannel !== mg.motionChannelId) {
    setPrevChannel(mg.motionChannelId);
    const next = readChannelSeed(mg.motionChannelId);
    setLocalChannel(mg.motionChannelId || "");
    setSliderVal(next.rot);
    setXyzVals(next.xyz);
  }

  const effectiveChannel = localChannel.trim();
  const motionType = mg.motionType || "motor";

  const driveMotor = (val: number) => {
    if (!effectiveChannel) return;
    motionController.setManual(effectiveChannel, "motor", [val]);
  };

  // The slider never stores an out-of-range value; it's clamped to the motor
  // limits at the point of use, so a limit change is reflected immediately
  // without writing state back.
  const clampedSliderVal = (() => {
    let v = sliderVal;
    if (mg.minLimit !== undefined) v = Math.max(mg.minLimit, v);
    if (mg.maxLimit !== undefined) v = Math.min(mg.maxLimit, v);
    return v;
  })();

  // Push a limit-driven clamp out to the MotionController. This only syncs an
  // external system (no React state is set here), so it belongs in an effect.
  useEffect(() => {
    if (motionType === "motor" && clampedSliderVal !== sliderVal) {
      driveMotor(clampedSliderVal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedSliderVal, sliderVal, motionType]);

  const driveXYZ = (axis: "x" | "y" | "z", val: number) => {
    if (!effectiveChannel) return;
    const next = { ...xyzVals, [axis]: val };
    setXyzVals(next);
    const vals: [number, number, number] = [
      next.x || 0,
      next.z || 0,
      next.y || 0,
    ];
    motionController.setManual(effectiveChannel, motionType === "xyz_rotation" ? "xyz_rotation" : "linear", vals);
  };

  return (
    <div
      style={{
        marginTop: "10px",
        background: "rgba(30, 41, 59, 0.4)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: 8,
        padding: "10px",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: ".07em",
          fontWeight: 700,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </svg>
        Movement Override
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: "9px", color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>Motor Channel</div>
        <input
          type="text"
          style={{
            width: "100%",
            background: "#0f172a",
            color: "#e2e8f0",
            border: `1px solid ${effectiveChannel ? "rgba(99,102,241,0.5)" : "#334155"}`,
            borderRadius: 6,
            padding: "5px 8px",
            fontSize: 12,
            outline: "none",
            transition: "border-color 0.2s",
            boxSizing: "border-box",
          }}
          placeholder="e.g. motor_1"
          value={localChannel}
          onChange={(e) => {
            const val = e.target.value;
            setLocalChannel(val);
            if (val.trim()) {
              updateMotorGroupMotion(mg.id, val.trim());
            }
          }}
        />
        {!effectiveChannel && (
          <div style={{ fontSize: "9px", color: "#f87171", marginTop: 3 }}>
            Enter motor name to enable sliders
          </div>
        )}
      </div>

      {motionType === "motor" && (
        <div style={{ opacity: effectiveChannel ? 1 : 0.4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10px", color: "#cbd5e1", marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>Rotation ({mg.jointAxis?.toUpperCase() || "Y"} axis)</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#34d399" }}>{clampedSliderVal}°</span>
              {effectiveChannel && (
                <button
                  onClick={() => {
                    setSliderVal(0);
                    driveMotor(0);
                  }}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    padding: "1px 4px",
                    fontSize: "8px",
                    cursor: "pointer",
                    color: "#94a3b8"
                  }}
                  title="Reset to 0"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <div style={{ position: "absolute", left: "50%", width: "1px", height: "8px", background: "rgba(255,255,255,0.25)", pointerEvents: "none" }} />
            <input
              className="rp-dim-slider"
              type="range"
              min={mg.minLimit !== undefined ? String(mg.minLimit) : "-180"}
              max={mg.maxLimit !== undefined ? String(mg.maxLimit) : "180"}
              step="1"
              value={clampedSliderVal}
              disabled={!effectiveChannel}
              style={{ width: "100%", cursor: effectiveChannel ? "pointer" : "default" }}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSliderVal(val);
                driveMotor(val);
              }}
              title={effectiveChannel ? "Drag to rotate motor shapes" : "Enter motor name first"}
            />
          </div>
        </div>
      )}

      {(motionType === "xyz_rotation" || motionType === "linear") && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, background: "rgba(0,0,0,0.25)", padding: 6, borderRadius: 8, opacity: effectiveChannel ? 1 : 0.4 }}>
          {(["x", "y", "z"] as const).map((ax) => {
            const rangeMin = motionType === "xyz_rotation" ? -180 : -10;
            const rangeMax = motionType === "xyz_rotation" ? 180 : 10;
            const rangeStep = motionType === "xyz_rotation" ? 1 : 0.1;
            const axColor = ax === "x" ? "accent-red-500" : ax === "y" ? "accent-emerald-500" : "accent-blue-500";
            const textCol = ax === "x" ? "#f87171" : ax === "y" ? "#34d399" : "#60a5fa";
            const badgeBg = ax === "x" ? "rgba(239,68,68,0.1)" : ax === "y" ? "rgba(52,211,153,0.1)" : "rgba(59,130,246,0.1)";
            const badgeBorder = ax === "x" ? "rgba(239,68,68,0.2)" : ax === "y" ? "rgba(52,211,153,0.2)" : "rgba(59,130,246,0.2)";
            const val = xyzVals[ax] ?? 0;

            return (
              <div key={ax} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.02)", padding: 4, borderRadius: 6 }}>
                {/* Axis badge */}
                <span style={{ fontSize: "8px", fontWeight: 700, width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${badgeBorder}`, borderRadius: 3, background: badgeBg, color: textCol }}>
                  <span style={{ margin: "auto" }}>{ax.toUpperCase()}</span>
                </span>

                {/* Vertical Slider Wrapper */}
                <div style={{ position: "relative", height: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 0" }}>
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.1)" }} />
                  <input
                    type="range"
                    min={rangeMin}
                    max={rangeMax}
                    step={rangeStep}
                    value={val}
                    disabled={!effectiveChannel}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      driveXYZ(ax, v);
                    }}
                    style={{
                      writingMode: "vertical-lr",
                      WebkitAppearance: "slider-vertical",
                      height: "48px",
                      width: "12px",
                      padding: "0",
                      margin: "0",
                      cursor: effectiveChannel ? "pointer" : "default"
                    }}
                    className={`cursor-pointer ${axColor}`}
                  />
                </div>

                {/* Value display */}
                <div style={{ fontSize: "8px", fontWeight: 600, fontFamily: "monospace", color: "#cbd5e1" }}>
                  {motionType === "xyz_rotation" ? `${Math.round(val)}°` : val.toFixed(1)}
                </div>

                {/* Reset button */}
                <button
                  disabled={!effectiveChannel}
                  onClick={() => driveXYZ(ax, 0)}
                  style={{
                    width: 14,
                    height: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 3,
                    border: "1px solid rgba(255,255,255,0.05)",
                    background: "rgba(255,255,255,0.02)",
                    color: val !== 0 ? "#f87171" : "#64748b",
                    fontSize: "6px",
                    cursor: effectiveChannel ? "pointer" : "default"
                  }}
                  title="Reset to 0"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
type MotionControlSectionProps = {
  shapes: ShapeType[];
  selectedShapes: ShapeType[];
  primarySelected: ShapeType | null;
  groups: GroupType[];
  motorGroups: MotorGroup[];
  motionController: MotionController;
  updateMotion: (id: number, channelId?: string, type?: MotionType, inverted?: boolean, jointAxis?: "x" | "y" | "z" | "xyz") => void;
  makeSelectedGroupJoint: (axis: "x" | "y" | "z", parentGroupId?: number) => void;
  updateSelectedGroupJointRotation: (rotation: number) => void;
  updateGroupJointRotationById: (groupId: number, rotation: number) => void;
  updateSelectedGroupPivot: (pivot: [number, number, number]) => void;
  updateSelectedGroupPivotShapeId: (pivotShapeId?: number) => void;
  updateGroupMotion: (groupId: number, channelId?: string, type?: MotionType, inverted?: boolean) => void;
  setSelectedIds: (ids: number[]) => void;
  ungroupShapes: () => void;
  createMotorGroup: (
    shapeIds: number[],
    name?: string,
    motionChannelId?: string,
    motionType?: MotionType,
    motionInverted?: boolean,
    jointAxis?: "x" | "y" | "z",
  ) => number;
  updateMotorGroupShapes: (motorGroupId: number, shapeIds: number[]) => void;
  updateMotorGroupMotion: (motorGroupId: number, channelId?: string, type?: MotionType, inverted?: boolean, vehicleRole?: "drive" | "steer" | "none") => void;
  deleteMotorGroup: (motorGroupId: number) => void;
  updateMotorGroupPivot: (motorGroupId: number, pivot: [number, number, number]) => void;
  updateMotorGroupAxis: (motorGroupId: number, jointAxis: "x" | "y" | "z", pivotShapeId?: number) => void;
  updateMotorGroupLimits: (motorGroupId: number, minLimit?: number, maxLimit?: number) => void;
};

export function MotionControlSection({
  shapes,
  selectedShapes,
  primarySelected,
  groups,
  motorGroups,
  motionController,
  updateMotion,
  makeSelectedGroupJoint,
  updateSelectedGroupJointRotation,
  updateGroupJointRotationById,
  updateSelectedGroupPivot,
  updateSelectedGroupPivotShapeId,
  updateGroupMotion,
  setSelectedIds,
  ungroupShapes,
  createMotorGroup,
  updateMotorGroupShapes,
  updateMotorGroupMotion,
  deleteMotorGroup,
  updateMotorGroupAxis,
  updateMotorGroupLimits,
}: MotionControlSectionProps) {
  const [jointAxisPick, setJointAxisPick] = useState<"x" | "y" | "z">("y");
  const [armChainLastJointId, setArmChainLastJointId] = useState<number | null>(null);
  const [, forceUpdate] = useState(0);

  const getOverrideAxisVal = (ax: "x" | "y" | "z") => {
    if (primarySelected?.motionChannelId) {
      const ms = motionController.getState(primarySelected.motionChannelId, 0);
      if (ms && (ms.type === "xyz_rotation" || ms.type === "linear") && ms.values) {
        const idx = ax === "x" ? 0 : ax === "y" ? 2 : 1;
        return ms.values[idx] ?? 0;
      }
    }
    return 0;
  };

  const driveOverrideXYZ = (ax: "x" | "y" | "z", val: number) => {
    if (!primarySelected?.motionChannelId) return;
    const ms = motionController.getState(primarySelected.motionChannelId, 0);
    const vals: [number, number, number] = [0, 0, 0];
    if (ms?.values) {
      for (let j = 0; j < Math.min(3, ms.values.length); j++) {
        vals[j] = ms.values[j] ?? 0;
      }
    }
    const idx = ax === "x" ? 0 : ax === "y" ? 2 : 1;
    vals[idx] = val;
    motionController.setManual(primarySelected.motionChannelId, primarySelected.motionType === "xyz_rotation" ? "xyz_rotation" : "linear", vals);
    forceUpdate(prev => prev + 1);
  };

  // Local buffer for the per-shape Motion Channel ID text field — committed on
  // blur / Enter rather than on every keystroke (typing "motor_1" across a
  // multi-selection otherwise fired one updateMotion per char per shape).
  // Re-synced from the store whenever the selected shape (or its stored
  // channel) changes. Same local-buffer pattern as InspectorSection's name
  // field.
  const [localMotionChannel, setLocalMotionChannel] = useState(
    primarySelected?.motionChannelId ?? "",
  );
  // Re-sync the buffer when the selected shape (or its stored channel) changes
  // — adjust-state-while-rendering with a prev-value guard rather than an
  // effect, so there is no extra render commit.
  const channelSyncKey = `${primarySelected?.id ?? ""}:${primarySelected?.motionChannelId ?? ""}`;
  const [prevChannelSyncKey, setPrevChannelSyncKey] = useState(channelSyncKey);
  if (prevChannelSyncKey !== channelSyncKey) {
    setPrevChannelSyncKey(channelSyncKey);
    setLocalMotionChannel(primarySelected?.motionChannelId ?? "");
  }
  const commitMotionChannel = () => {
    const next = localMotionChannel.trim();
    if (next === (primarySelected?.motionChannelId ?? "")) return;
    selectedShapes.forEach((shape) => updateMotion(shape.id, next));
  };

  // Track which motor group is "pending save" (just created, unsaved)
  const [pendingSaveId, setPendingSaveId] = useState<number | null>(null);
  // Track which saved motor is selected in Motion Signal Control picker
  const [selectedMotorId, setSelectedMotorId] = useState<number | null>(null);
  // Track which motor group is currently active/selected for display in Motor Groups section
  const [activeMotorId, setActiveMotorId] = useState<number | null>(null);

  // Auto-select the first motor group ONCE, on the first render where any
  // group exists (genuine initial load / restore). After that we respect an
  // explicit null — picking "— none —" in the dropdown, or deleting the
  // active motor, should leave nothing selected rather than snapping back.
  // State (not a ref) so it can be read/written while rendering below.
  const [didAutoSelectMotor, setDidAutoSelectMotor] = useState(false);
  // Keep activeMotorId consistent with the live motorGroups list. Done while
  // rendering (guarded so it converges) instead of in an effect: each branch
  // stops matching once it has corrected the state.
  if (activeMotorId !== null && !motorGroups.some(mg => mg.id === activeMotorId)) {
    // Active id points at a group that no longer exists → fall back to the
    // first remaining group, or null if the list is now empty.
    setActiveMotorId(motorGroups.length > 0 ? motorGroups[0].id : null);
  } else if (
    // One-time bootstrap selection on the first render where a group exists.
    !didAutoSelectMotor &&
    activeMotorId === null &&
    motorGroups.length > 0
  ) {
    setDidAutoSelectMotor(true);
    setActiveMotorId(motorGroups[0].id);
  }

  // Only shapes that belong to a traditional group (parentId) trigger group UI
  const selectedGroupIds = Array.from(
    new Set(selectedShapes.map((s) => s.parentId).filter((id): id is number => !!id)),
  );
  const singleSelectedGroupId = selectedGroupIds.length === 1 ? selectedGroupIds[0] : null;
  const selectedGroup = singleSelectedGroupId !== null
    ? groups.find((g) => g.id === singleSelectedGroupId)
    : undefined;
  const isSelectedGroupJoint = !!selectedGroup?.isJoint;
  const canAddAsNext =
    singleSelectedGroupId !== null &&
    armChainLastJointId !== null &&
    armChainLastJointId !== singleSelectedGroupId;

  // The currently selected motor (from picker)
  const pickedMotor = motorGroups.find(mg => mg.id === selectedMotorId) || null;

  return (
    <>
      {/* ── Traditional Group Joints ─────────────────────────────────────── */}
      {singleSelectedGroupId !== null && (
        <div className="rp-prop-block animate-in">
          <div className="rp-prop-label">Selected Group</div>
          <div className="rp-btn-stack">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <button
                className="rp-secondary-btn"
                onClick={() => {
                  makeSelectedGroupJoint("y", undefined);
                  setJointAxisPick("y");
                  setArmChainLastJointId(singleSelectedGroupId);
                }}
                title="Make this group the base/root joint"
              >
                Make BASE
              </button>
              <button
                className="rp-secondary-btn"
                onClick={() => {
                  if (!canAddAsNext) return;
                  makeSelectedGroupJoint(jointAxisPick, armChainLastJointId!);
                  setArmChainLastJointId(singleSelectedGroupId);
                }}
                disabled={!canAddAsNext}
                title={canAddAsNext ? "Attach this group after the previous joint" : "Make a different group BASE first"}
              >
                Add NEXT
              </button>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              {(["x", "y", "z"] as const).map((ax) => (
                <button
                  key={ax}
                  className={`rp-secondary-btn ${jointAxisPick === ax ? "active" : ""}`}
                  onClick={() => {
                    setJointAxisPick(ax);
                    makeSelectedGroupJoint(ax, selectedGroup?.parentGroupId);
                  }}
                >
                  Axis {ax.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="rp-primary-btn"
              style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)", color: "#a7f3d0" }}
              onClick={ungroupShapes}
              title="Ungroup all parts in this selected group"
            >
              Ungroup Whole Group
            </button>
          </div>

          {isSelectedGroupJoint && selectedGroup && (
            <div style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "11px", color: "#94a3b8", display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>Joint Rotation ({selectedGroup.jointAxis?.toUpperCase() || "Y"})</span>
                <span>{(selectedGroup.jointRotation || 0).toFixed(1)}deg</span>
              </div>
              <input
                className="rp-dim-slider"
                type="range" min="-180" max="180" step="1"
                value={selectedGroup.jointRotation || 0}
                onChange={(e) => updateSelectedGroupJointRotation(Number(e.target.value))}
                title="Joint rotation"
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button
                  className="rp-secondary-btn"
                  onClick={() => { const s = primarySelected; if (!s) return; updateSelectedGroupPivot([s.position[0], s.position[1], s.position[2]]); }}
                  title="Snap pivot to selected shape position"
                >
                  Pivot = Selected
                </button>
                <button
                  className="rp-secondary-btn"
                  onClick={() => {
                    const members = selectedShapes.filter((m) => m.parentId === selectedGroup.id);
                    if (!members.length) return;
                    const c = members.reduce((acc, m) => { acc[0] += m.position[0]; acc[1] += m.position[1]; acc[2] += m.position[2]; return acc; }, [0, 0, 0] as [number, number, number]);
                    c[0] /= members.length; c[1] /= members.length; c[2] /= members.length;
                    updateSelectedGroupPivot(c);
                  }}
                  title="Reset pivot to group center"
                >
                  Pivot = Center
                </button>
              </div>
              <div style={{ marginTop: "10px", marginBottom: "10px" }}>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "4px", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Rotation Pivot Part
                </div>
                <select
                  style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
                  value={selectedGroup.pivotShapeId ?? ""}
                  onChange={(e) => { const val = e.target.value; updateSelectedGroupPivotShapeId(val ? Number(val) : undefined); }}
                >
                  <option value="">Group Center / Manual Coordinate</option>
                  {shapes.filter((s) => s.parentId === selectedGroup.id).map((m) => (
                    <option key={m.id} value={m.id}>{m.name || `${m.type.toUpperCase()} (#${m.id})`}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: "10px" }}>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "4px", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Group Motor Channel
                </div>
                <input
                  type="text"
                  style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12, marginBottom: 8, boxSizing: "border-box" }}
                  placeholder="e.g. motor_1"
                  value={selectedGroup.motionChannelId ?? ""}
                  onChange={(e) => updateGroupMotion(selectedGroup.id, e.target.value)}
                />
                <select
                  style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12, marginBottom: 8 }}
                  value={selectedGroup.motionType ?? "motor"}
                  onChange={(e) => updateGroupMotion(selectedGroup.id, undefined, e.target.value as MotionType)}
                >
                  <option value="motor">Motor (Joint Axis)</option>
                  <option value="xyz_rotation">XYZ Rotation</option>
                  <option value="linear">Linear Translation</option>
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", fontSize: "11px", color: "#94a3b8", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!selectedGroup.motionInverted}
                    onChange={(e) => updateGroupMotion(selectedGroup.id, undefined, undefined, e.target.checked)}
                  />
                  Invert Joint Direction
                </label>
                <input
                  className="rp-dim-slider"
                  type="range" min="-180" max="180" step="1"
                  // Controlled from the same source as the "Joint Rotation"
                  // slider above (selectedGroup.jointRotation) — it used to be
                  // `defaultValue`, so moving one slider left the other stuck
                  // at its mount value until a remount.
                  value={selectedGroup.jointRotation || 0}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    updateGroupJointRotationById(selectedGroup.id, value);
                    if (selectedGroup.motionChannelId) {
                      motionController.setManual(selectedGroup.motionChannelId, selectedGroup.motionType ?? "motor", [value, value, value]);
                    }
                  }}
                  title="Drive selected joint motor"
                />
              </div>
            </div>
          )}

          {/* Group Members List */}
          {(() => {
            const groupMembers = shapes.filter((s) => s.parentId === singleSelectedGroupId);
            if (groupMembers.length === 0) return null;
            return (
              <div style={{ marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "12px" }}>
                <div className="rp-prop-label">Group Members</div>
                <div style={{ display: "grid", gap: "6px", marginTop: "6px" }}>
                  {groupMembers.map((m) => {
                    const isSel = selectedShapes.length === 1 && selectedShapes[0].id === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={() => setSelectedIds([m.id])}
                        style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "6px 10px",
                          background: isSel ? "rgba(67,97,238,0.15)" : "rgba(255,255,255,0.02)",
                          border: isSel ? "1px solid rgba(67,97,238,0.4)" : "1px solid rgba(255,255,255,0.05)",
                          borderRadius: "8px", cursor: "pointer", fontSize: "11px", transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ width: 10, height: 10, borderRadius: m.type === "sphere" ? "50%" : "2px", background: m.color || "#ccc", border: "1px solid rgba(255,255,255,0.1)" }} />
                        <span style={{ flex: 1, color: isSel ? "#c7d2fe" : "#cbd5e1", fontWeight: 600 }}>{m.name || `${m.type.charAt(0).toUpperCase() + m.type.slice(1)} #${m.id}`}</span>
                        <span style={{ fontSize: "9px", color: isSel ? "#a5b4fc" : "#64748b" }}>{isSel ? "Selected" : "Select Part"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Motor Groups ─────────────────────────────────────────────────── */}
      <div className="rp-prop-block animate-in">
        <div className="rp-prop-label">Motor Groups</div>
        <div className="rp-btn-stack">

          {/* ── Add New Motor button ── */}
          <button
            className="rp-primary-btn"
            style={{
              width: "100%", fontSize: "12px", padding: "8px",
              background: "rgba(99,102,241,0.2)",
              borderColor: "rgba(99,102,241,0.6)",
              color: "#a5b4fc",
              fontWeight: 700,
              marginBottom: 8,
            }}
            onClick={() => {
              const ids = selectedShapes.map(s => s.id);
              const pendingGroup = motorGroups.find(mg => mg.id === pendingSaveId);
              if (pendingGroup && pendingGroup.shapeIds.length === 0 && ids.length > 0) {
                updateMotorGroupShapes(pendingGroup.id, ids);
              } else {
                const newId = createMotorGroup(ids, `Motor ${motorGroups.length + 1}`);
                setPendingSaveId(newId);
                setActiveMotorId(newId);
              }
            }}
          >
            {selectedShapes.length > 0
              ? `＋ Create Motor (${selectedShapes.length} shape${selectedShapes.length > 1 ? "s" : ""})`
              : "＋ Add Motor Group"}
          </button>

          {motorGroups.length === 0 && (
            <div style={{ fontSize: "11px", color: "#64748b", textAlign: "center", padding: "8px", fontStyle: "italic" }}>
              No motor groups
            </div>
          )}

          {/* Motor Group Dropdown Selector */}
          {motorGroups.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <select
                value={activeMotorId || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setActiveMotorId(val ? Number(val) : null);
                }}
                style={{
                  width: "100%",
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  padding: "7px 10px",
                  fontSize: "12px",
                  color: "#e2e8f0",
                  cursor: "pointer",
                  outline: "none",
                  fontWeight: 600,
                  transition: "all 0.15s",
                }}
              >
                {motorGroups.map((mg) => (
                  <option key={mg.id} value={mg.id}>
                    {mg.name || `Motor #${mg.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Render only the active motor group details */}
          {activeMotorId !== null && (() => {
            const mg = motorGroups.find(m => m.id === activeMotorId);
            if (!mg) return null;
            const memberShapes = shapes.filter((s) => mg.shapeIds.includes(s.id));
            const isPending = mg.id === pendingSaveId;
            return (
              <div
                style={{
                  background: isPending ? "rgba(99,102,241,0.06)" : "rgba(30,41,59,0.5)",
                  border: isPending ? "1.5px solid rgba(99,102,241,0.4)" : "1px solid rgba(51,65,85,0.5)",
                  borderRadius: 8, padding: "10px", marginTop: "8px",
                }}
              >
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: isPending ? "#a5b4fc" : "#e2e8f0", whiteSpace: "nowrap" }}>
                    {mg.name || `Motor #${mg.id}`}
                  </span>
                  <button
                    className="rp-secondary-btn"
                    style={{ width: "auto", padding: "2px 6px", fontSize: "10px", background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#f87171" }}
                    onClick={() => { deleteMotorGroup(mg.id); if (pendingSaveId === mg.id) setPendingSaveId(null); if (selectedMotorId === mg.id) setSelectedMotorId(null); if (activeMotorId === mg.id) setActiveMotorId(null); }}
                  >
                    Delete
                  </button>
                </div>

                <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "8px" }}>
                  {memberShapes.length} shape{memberShapes.length !== 1 ? "s" : ""}
                </div>

                {/* Shape management */}
                <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                  <button
                    className="rp-secondary-btn"
                    style={{ flex: 1, fontSize: "11px", padding: "6px" }}
                    onClick={() => {
                      const currentSelected = selectedShapes.map(s => s.id);
                      const newSelection = Array.from(new Set([...currentSelected, ...mg.shapeIds]));
                      setSelectedIds(newSelection);
                      updateMotorGroupShapes(mg.id, newSelection);
                    }}
                  >
                    Add 
                  </button>
                  <button
                    className="rp-secondary-btn"
                    style={{
                      flex: 1, fontSize: "11px", padding: "6px",
                      background: "rgba(239,68,68,0.06)",
                      borderColor: "rgba(239,68,68,0.25)",
                      color: "#f87171",
                    }}
                    onClick={() => {
                      const selectedIdsToClear = selectedShapes.map(s => s.id);
                      const newShapeIds = mg.shapeIds.filter(id => !selectedIdsToClear.includes(id));
                      updateMotorGroupShapes(mg.id, newShapeIds);
                    }}
                  >
                    Remove 
                  </button>
                </div>

                {/* Axis */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                    Axis
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["x", "y", "z"] as const).map((ax) => (
                      <button
                        key={ax}
                        className={`rp-secondary-btn ${(mg.jointAxis || "y") === ax ? "active" : ""}`}
                        style={{
                          flex: 1, fontSize: "11px",
                          color: (mg.jointAxis || "y") === ax ? (ax === "x" ? "#ef4444" : ax === "y" ? "#22c55e" : "#3b82f6") : undefined,
                          borderColor: (mg.jointAxis || "y") === ax ? (ax === "x" ? "rgba(239,68,68,0.4)" : ax === "y" ? "rgba(34,197,94,0.4)" : "rgba(59,130,246,0.4)") : undefined,
                          background: (mg.jointAxis || "y") === ax ? (ax === "x" ? "rgba(239,68,68,0.1)" : ax === "y" ? "rgba(34,197,94,0.1)" : "rgba(59,130,246,0.1)") : undefined,
                        }}
                        onClick={() => updateMotorGroupAxis(mg.id, ax, mg.pivotShapeId)}
                      >
                        {ax.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Motion Channel */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                    Channel
                  </div>
                  <input
                    type="text"
                    style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12, boxSizing: "border-box" }}
                    placeholder="motor_1"
                    value={mg.motionChannelId || ""}
                    onChange={(e) => updateMotorGroupMotion(mg.id, e.target.value || undefined)}
                  />
                </div>

                {/* Type + Invert */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <select
                    style={{ flex: 1, background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
                    value={mg.motionType || "motor"}
                    onChange={(e) => updateMotorGroupMotion(mg.id, mg.motionChannelId, e.target.value as MotionType)}
                  >
                    <option value="motor">Motor</option>
                    <option value="xyz_rotation">XYZ Rotation</option>
                    <option value="linear">Linear</option>
                  </select>
                  <button
                    className={`rp-secondary-btn ${mg.motionInverted ? "active" : ""}`}
                    style={{ flex: 1, fontSize: "11px" }}
                    onClick={() => updateMotorGroupMotion(mg.id, mg.motionChannelId, mg.motionType, !mg.motionInverted)}
                  >
                    {mg.motionInverted ? "Inverted" : "Invert"}
                  </button>
                </div>

                {/* Pivot Shape */}
                {memberShapes.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                      Pivot
                    </div>
                    <select
                      style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
                      value={mg.pivotShapeId ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateMotorGroupAxis(mg.id, mg.jointAxis || "y", val ? Number(val) : undefined);
                      }}
                    >
                      <option value="">Center</option>
                      {memberShapes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name || `${s.type.toUpperCase()} #${s.id}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ marginTop: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                    Vehicle Role (Physics Mode)
                  </div>
                  <select
                    style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
                    value={mg.vehicleRole || "none"}
                    onChange={(e) => updateMotorGroupMotion(mg.id, mg.motionChannelId, mg.motionType, mg.motionInverted, e.target.value as "drive" | "steer" | "none")}
                  >
                    <option value="none">None / Unassigned</option>
                    <option value="drive">Drive (Throttle)</option>
                    <option value="steer">Steering</option>
                  </select>
                </div>

                {/* Motor Limits (Min/Max Angle) */}
                {(mg.motionType === "motor" || !mg.motionType) && (
                  <div style={{ display: "flex", gap: "8px", marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: 3 }}>Min Angle °</div>
                      <input
                        type="number"
                        style={{
                          width: "100%",
                          background: "#1e293b",
                          color: "#e2e8f0",
                          border: "1px solid #334155",
                          borderRadius: 6,
                          padding: "5px 8px",
                          fontSize: 12,
                          boxSizing: "border-box",
                          outline: "none",
                        }}
                        placeholder="-180"
                        value={mg.minLimit !== undefined ? mg.minLimit : ""}
                        onChange={(e) => {
                          const val = e.target.value === "" ? undefined : Number(e.target.value);
                          updateMotorGroupLimits(mg.id, val, mg.maxLimit);
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: 3 }}>Max Angle °</div>
                      <input
                        type="number"
                        style={{
                          width: "100%",
                          background: "#1e293b",
                          color: "#e2e8f0",
                          border: "1px solid #334155",
                          borderRadius: 6,
                          padding: "5px 8px",
                          fontSize: 12,
                          boxSizing: "border-box",
                          outline: "none",
                        }}
                        placeholder="180"
                        value={mg.maxLimit !== undefined ? mg.maxLimit : ""}
                        onChange={(e) => {
                          const val = e.target.value === "" ? undefined : Number(e.target.value);
                          updateMotorGroupLimits(mg.id, mg.minLimit, val);
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* ── Save Motor Buttons ── */}
                {isPending && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {/* Save Motor */}
                    <button
                      className="rp-primary-btn"
                      style={{
                        flex: 1, fontSize: "11px", padding: "8px",
                        background: "rgba(99,102,241,0.15)", borderColor: "rgba(99,102,241,0.5)", color: "#a5b4fc",
                        fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      }}
                      onClick={() => setPendingSaveId(null)}
                      title="Save this motor"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2.5">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                      Save Motor
                    </button>

                    {/* Save & Add New Motor */}
                    <button
                      className="rp-primary-btn"
                      style={{
                        flex: 1, fontSize: "11px", padding: "8px",
                        background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.45)", color: "#34d399",
                        fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      }}
                      onClick={() => {
                        // Deselect so user can pick fresh shapes for the next motor
                        setSelectedIds([]);
                        // Create the next empty motor group immediately
                        const newId = createMotorGroup([], `Motor ${motorGroups.length + 1}`);
                        setPendingSaveId(newId);
                        setActiveMotorId(newId);
                      }}
                      title="Save this motor and immediately create a new one"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="16" />
                        <line x1="8" y1="12" x2="16" y2="12" />
                      </svg>
                      Save & Add New
                    </button>
                  </div>
                )}

                {/* Movement sliders */}
                <MotorMovementBlock key={mg.id} mg={mg} motionController={motionController} updateMotorGroupMotion={updateMotorGroupMotion} />
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Motion Signal Control ─────────────────────────────────────────── */}
      {(selectedShapes.length >= 1 || motorGroups.length > 0) && primarySelected && (
        <div
          className="rp-prop-block"
          style={{ border: "1.5px solid #10b981", borderRadius: 10, background: "linear-gradient(135deg,#064e3b22,#065f4622)", padding: "12px 10px 10px" }}
        >
          <div
            className="rp-prop-label"
            style={{ color: "#34d399", fontWeight: 700, letterSpacing: ".03em", display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Motion Signal Control
          </div>

          {/* ── Saved Motor Picker ── */}
          {motorGroups.filter(mg => !pendingSaveId || mg.id !== pendingSaveId).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "10px", color: "#34d399", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".06em" }}>
                Select Saved Motor
              </div>
              <div style={{ display: "flex", width: "100%" }}>
                <select
                  value={selectedMotorId || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedMotorId(val ? Number(val) : null);
                  }}
                  style={{
                    width: "100%",
                    background: "#0f172a",
                    border: `1.5px solid ${selectedMotorId ? "rgba(52,211,153,0.6)" : "rgba(52,211,153,0.2)"}`,
                    borderRadius: 6,
                    padding: "7px 10px",
                    fontSize: "11px",
                    color: selectedMotorId ? "#34d399" : "#94a3b8",
                    cursor: "pointer",
                    outline: "none",
                    fontWeight: selectedMotorId ? 700 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  <option value="" style={{ background: "#0f172a", color: "#64748b" }}>
                    -- Select a Motor --
                  </option>
                  {motorGroups
                    .filter(mg => !pendingSaveId || mg.id !== pendingSaveId)
                    .map(mg => (
                      <option 
                        key={mg.id} 
                        value={mg.id}
                        style={{ background: "#0f172a", color: "#f8fafc" }}
                      >
                        {mg.name || `Motor #${mg.id}`}
                      </option>
                    ))}
                </select>
              </div>
              {pickedMotor && (
                <div style={{ marginTop: 10, padding: 10, background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 8 }}>
                  <div style={{ fontSize: "11px", color: "#34d399", fontWeight: 700, marginBottom: 6 }}>
                    {pickedMotor.name} — Quick Drive
                  </div>
                  <MotorMovementBlock key={pickedMotor.id} mg={pickedMotor} motionController={motionController} updateMotorGroupMotion={updateMotorGroupMotion} />
                </div>
              )}
            </div>
          )}

          {/* Show motor groups that selected shapes belong to */}
          {(() => {
            const selIds = selectedShapes.map(s => s.id);
            const related = motorGroups.filter(mg => mg.shapeIds.some(id => selIds.includes(id)));
            if (related.length === 0) return null;
            return (
              <div style={{ marginBottom: 9 }}>
                <div style={{ fontSize: 10, color: "#34d399", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Part of Motor Groups
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
                  {related.map(mg => (
                    <div
                      key={mg.id}
                      style={{
                        background: "rgba(52,211,153,0.1)",
                        border: "1px solid rgba(52,211,153,0.3)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: "11px",
                        color: "#34d399",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                      }}
                    >
                      <span>{mg.name || `Motor #${mg.id}`}</span>
                      <button
                        style={{
                          background: "none",
                          border: "none",
                          color: "#f87171",
                          cursor: "pointer",
                          fontWeight: "bold",
                          padding: "0 2px",
                          fontSize: "10px",
                          display: "flex",
                          alignItems: "center",
                          transition: "color 0.2s"
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#f43f5e"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#f87171"; }}
                        onClick={() => {
                          const newShapeIds = mg.shapeIds.filter(id => !selIds.includes(id));
                          updateMotorGroupShapes(mg.id, newShapeIds);
                        }}
                        title={`Remove selected shapes from ${mg.name || `Motor #${mg.id}`}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="rp-secondary-btn"
                  style={{
                    fontSize: "10px",
                    padding: "4px 8px",
                    background: "rgba(239,68,68,0.06)",
                    borderColor: "rgba(239,68,68,0.25)",
                    color: "#fca5a5",
                    width: "100%"
                  }}
                  onClick={() => {
                    related.forEach(mg => {
                      const newShapeIds = mg.shapeIds.filter(id => !selIds.includes(id));
                      updateMotorGroupShapes(mg.id, newShapeIds);
                    });
                  }}
                  title="Remove selected shapes from all motor groups they belong to"
                >
                  Remove Selected from All Motors
                </button>
              </div>
            );
          })()}

          {/* Per-shape motion channel */}
          <div style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Motion Channel ID
              {selectedShapes.length > 1 && (
                <span style={{ marginLeft: 8, fontSize: 9, color: "#64748b", fontWeight: "normal" }}>
                  (Apply to {selectedShapes.length} shapes)
                </span>
              )}
            </div>
            <input
              type="text"
              style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12, boxSizing: "border-box" }}
              placeholder="e.g. motor_1"
              value={localMotionChannel}
              onChange={(e) => setLocalMotionChannel(e.target.value)}
              onBlur={commitMotionChannel}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>

          {/* Quick Add to motor group */}
          {selectedShapes.length > 0 && motorGroups.length > 0 && (() => {
            const selIds = selectedShapes.map(s => s.id);
            return (
              <div style={{ marginBottom: 9 }}>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Quick Add to Motor Group
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {motorGroups.map(mg => (
                    <button
                      key={mg.id}
                      className="rp-secondary-btn"
                      style={{ fontSize: "10px", padding: "4px 8px" }}
                      onClick={() => {
                        const newShapeIds = Array.from(new Set([...mg.shapeIds, ...selIds]));
                        updateMotorGroupShapes(mg.id, newShapeIds);
                      }}
                      title={`Add selected shapes to ${mg.name || `Motor #${mg.id}`}`}
                    >
                      {mg.name || `Motor #${mg.id}`}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Motion Type */}
          <div style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Motion Type
            </div>
            <select
              style={{ width: "100%", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
              value={primarySelected?.motionType ?? "motor"}
              onChange={(e) => {
                const motionType = e.target.value as MotionType;
                selectedShapes.forEach(shape => updateMotion(shape.id, undefined, motionType));
              }}
            >
              <option value="motor">Motor (1-Axis Rotation)</option>
              <option value="xyz_rotation">XYZ Rotation (3-Axis)</option>
              <option value="linear">Linear Translation</option>
            </select>
          </div>

          {/* Rotation Axis */}
          {(primarySelected?.motionType === "motor" || !primarySelected?.motionType) && (
            <div style={{ marginBottom: 9 }}>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                Rotation Axis
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["x", "y", "z"] as const).map((ax) => (
                  <button
                    key={ax}
                    className={`rp-secondary-btn ${(primarySelected?.jointAxis || "y") === ax ? "active" : ""}`}
                    style={{
                      flex: 1,
                      fontSize: "11px",
                      color: (primarySelected?.jointAxis || "y") === ax ? (ax === "x" ? "#ef4444" : ax === "y" ? "#22c55e" : "#3b82f6") : undefined,
                      borderColor: (primarySelected?.jointAxis || "y") === ax ? (ax === "x" ? "rgba(239,68,68,0.4)" : ax === "y" ? "rgba(34,197,94,0.4)" : "rgba(59,130,246,0.4)") : undefined,
                      background: (primarySelected?.jointAxis || "y") === ax ? (ax === "x" ? "rgba(239,68,68,0.1)" : ax === "y" ? "rgba(34,197,94,0.1)" : "rgba(59,130,246,0.1)") : undefined,
                    }}
                    onClick={() => {
                      selectedShapes.forEach(shape => updateMotion(shape.id, undefined, undefined, undefined, ax));
                    }}
                    title={`Rotate around ${ax.toUpperCase()} axis`}
                  >
                    {ax.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Invert */}
          <div style={{ marginBottom: 9 }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94a3b8", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!primarySelected?.motionInverted}
                onChange={(e) => {
                  const inverted = e.target.checked;
                  selectedShapes.forEach(shape => updateMotion(shape.id, undefined, undefined, inverted));
                }}
              />
              Invert Signal Direction
            </label>
          </div>

          {/* Create Motor Group (from Motion Signal section) */}
          {selectedShapes.length > 0 && (
            <div style={{ marginBottom: 9 }}>
              <button
                className="rp-primary-btn"
                style={{ width: "100%", fontSize: "11px", padding: "8px", background: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.3)", color: "#34d399" }}
                onClick={() => {
                  const ids = selectedShapes.map(s => s.id);
                  const newId = createMotorGroup(ids, `Motor ${motorGroups.length + 1}`);
                  setPendingSaveId(newId);
                  setActiveMotorId(newId);
                }}
                title="Create a new motor group with currently selected shapes"
              >
                Create Motor Group from Selection
              </button>
            </div>
          )}

          {/* Manual Override Sliders */}
          <div style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Manual Override
            </div>

            {(!primarySelected.motionType || primarySelected.motionType === "motor") && (() => {
              const currentVal = (() => {
                if (primarySelected.motionChannelId) {
                  const ms = motionController.getState(primarySelected.motionChannelId, 0);
                  if (ms && ms.type === "motor" && ms.values && ms.values.length > 0) {
                    return Math.round(ms.values[0]);
                  }
                }
                return 0;
              })();

              return (
                <div style={{ opacity: primarySelected.motionChannelId ? 1 : 0.4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10px", color: "#cbd5e1", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>Rotation ({primarySelected.jointAxis?.toUpperCase() || "Y"} axis)</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#34d399" }}>{currentVal}°</span>
                      {primarySelected.motionChannelId && (
                        <button
                          onClick={() => {
                            motionController.setManual(primarySelected.motionChannelId!, "motor", [0]);
                            forceUpdate(prev => prev + 1);
                          }}
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 4,
                            padding: "1px 4px",
                            fontSize: "8px",
                            cursor: "pointer",
                            color: "#94a3b8"
                          }}
                          title="Reset to 0"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", left: "50%", width: "1px", height: "8px", background: "rgba(255,255,255,0.25)", pointerEvents: "none" }} />
                    <input
                      className="rp-dim-slider"
                      type="range" min="-180" max="180" step="1"
                      value={currentVal}
                      disabled={!primarySelected.motionChannelId}
                      style={{ width: "100%", cursor: primarySelected.motionChannelId ? "pointer" : "default" }}
                      onChange={(e) => {
                        if (primarySelected.motionChannelId) {
                          motionController.setManual(primarySelected.motionChannelId, "motor", [Number(e.target.value)]);
                          forceUpdate(prev => prev + 1);
                        }
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            {(primarySelected.motionType === "xyz_rotation" || primarySelected.motionType === "linear") && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, background: "rgba(0,0,0,0.25)", padding: 6, borderRadius: 8, opacity: primarySelected.motionChannelId ? 1 : 0.4 }}>
                {(["x", "y", "z"] as const).map((ax) => {
                  const rangeMin = primarySelected.motionType === "xyz_rotation" ? -180 : -10;
                  const rangeMax = primarySelected.motionType === "xyz_rotation" ? 180 : 10;
                  const rangeStep = primarySelected.motionType === "xyz_rotation" ? 1 : 0.1;
                  const axColor = ax === "x" ? "accent-red-500" : ax === "y" ? "accent-emerald-500" : "accent-blue-500";
                  const textCol = ax === "x" ? "#f87171" : ax === "y" ? "#34d399" : "#60a5fa";
                  const badgeBg = ax === "x" ? "rgba(239,68,68,0.1)" : ax === "y" ? "rgba(52,211,153,0.1)" : "rgba(59,130,246,0.1)";
                  const badgeBorder = ax === "x" ? "rgba(239,68,68,0.2)" : ax === "y" ? "rgba(52,211,153,0.2)" : "rgba(59,130,246,0.2)";
                  const val = getOverrideAxisVal(ax);

                  return (
                    <div key={ax} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.02)", padding: 4, borderRadius: 6 }}>
                      {/* Axis badge */}
                      <span style={{ fontSize: "8px", fontWeight: 700, width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${badgeBorder}`, borderRadius: 3, background: badgeBg, color: textCol }}>
                        <span style={{ margin: "auto" }}>{ax.toUpperCase()}</span>
                      </span>

                      {/* Vertical Slider Wrapper */}
                      <div style={{ position: "relative", height: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 0" }}>
                        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.1)" }} />
                        <input
                          type="range"
                          min={rangeMin}
                          max={rangeMax}
                          step={rangeStep}
                          value={val}
                          disabled={!primarySelected.motionChannelId}
                          onChange={(e) => {
                            driveOverrideXYZ(ax, Number(e.target.value));
                          }}
                          style={{
                            writingMode: "vertical-lr",
                            WebkitAppearance: "slider-vertical",
                            height: "48px",
                            width: "12px",
                            padding: "0",
                            margin: "0",
                            cursor: primarySelected.motionChannelId ? "pointer" : "default"
                          }}
                          className={`cursor-pointer ${axColor}`}
                        />
                      </div>

                      {/* Value display */}
                      <div style={{ fontSize: "8px", fontWeight: 600, fontFamily: "monospace", color: "#cbd5e1" }}>
                        {primarySelected.motionType === "xyz_rotation" ? `${Math.round(val)}°` : val.toFixed(1)}
                      </div>

                      {/* Reset button */}
                      <button
                        disabled={!primarySelected.motionChannelId}
                        onClick={() => driveOverrideXYZ(ax, 0)}
                        style={{
                          width: 14,
                          height: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 3,
                          border: "1px solid rgba(255,255,255,0.05)",
                          background: "rgba(255,255,255,0.02)",
                          color: val !== 0 ? "#f87171" : "#64748b",
                          fontSize: "6px",
                          cursor: primarySelected.motionChannelId ? "pointer" : "default"
                        }}
                        title="Reset to 0"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
