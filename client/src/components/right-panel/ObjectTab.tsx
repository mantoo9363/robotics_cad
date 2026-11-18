import React from "react";
import { Box } from "lucide-react";
import type { ShapeType, CircuitLinkOption, CustomAsset, GroupType, MotionPath, MotorGroup } from "../../App";
import type { CircuitStreamFrame, CircuitStreamStartPayload } from "../../lib/circuitStream";
import type { MotionController, MotionType } from "../../lib/motionController";
import { CircuitSection } from "./CircuitSection";
import { AddObjectsSection } from "./AddObjectsSection";
import { InspectorSection } from "./InspectorSection";
import { MotionControlSection } from "./MotionControlSection";

type ObjectTabProps = {
  shapes: ShapeType[];
  selectedShapes: ShapeType[];
  primarySelected: ShapeType | null;
  addShape: (type: string) => void;
  addGlbShape: (url: string) => void;
  customAssets: CustomAsset[];
  addCustomAsset: (name: string, url: string) => void;
  removeCustomAsset: (id: string) => void;
  circuitLinkOptions: CircuitLinkOption[];
  cadStreamConnected: boolean;
  liveSimulationFrame: CircuitStreamFrame | null;
  setPrimaryCircuitNodeId: (circuitNodeId: string) => void;
  lastCircuitStartPayload: CircuitStreamStartPayload | null;
  unitMode: string;
  streamHostLabel?: string;
  scale: string;
  toggleLock: () => void;
  toggleGripper: () => void;
  toggleGripping: () => void;
  toggleGrabbable: () => void;
  updateGripOffset: (axis: number, value: number) => void;
  duplicateShape: () => void;
  deleteShape: () => void;
  flattenGroup: () => void;
  groupShapes: () => void;
  ungroupShapes: () => void;
  subtractShapes: () => void;
  alignShapes: (axis: "x" | "y" | "z") => void;
  paths: MotionPath[];
  attachToPath: (pathId: number) => void;
  detachFromPath: () => void;
  updatePathSpeed: (speed: number) => void;
  toggleHole: () => void;
  updateColor: (color: string) => void;
  updateScale: (axis: number, value: number) => void;
  updateRotation: (axis: number, value: number) => void;
  updateTexture: (texturePath: string | null) => void;
  motionController: MotionController;
  updateMotion: (id: number, channelId?: string, type?: MotionType, inverted?: boolean, jointAxis?: "x" | "y" | "z" | "xyz") => void;
  groups: GroupType[];
  makeSelectedGroupJoint: (axis: "x" | "y" | "z", parentGroupId?: number) => void;
  updateSelectedGroupJointRotation: (rotation: number) => void;
  updateGroupJointRotationById: (groupId: number, rotation: number) => void;
  updateSelectedGroupPivot: (pivot: [number, number, number]) => void;
  updateSelectedGroupPivotShapeId: (pivotShapeId?: number) => void;
  updateGroupMotion: (groupId: number, channelId?: string, type?: MotionType, inverted?: boolean) => void;
  setSelectedIds: (ids: number[]) => void;
  motorGroups: MotorGroup[];
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
  updateShapePhysicsProperty: (id: number, key: "friction" | "restitution" | "fixedRotation" | "mass" | "collisionDisabled" | "name", value: any) => void;
};

export function ObjectTab({
  shapes,
  selectedShapes,
  primarySelected,
  addShape,
  addGlbShape,
  customAssets,
  addCustomAsset,
  removeCustomAsset,
  circuitLinkOptions,
  cadStreamConnected,
  liveSimulationFrame,
  setPrimaryCircuitNodeId,
  lastCircuitStartPayload,
  unitMode,
  streamHostLabel,
  scale,
  toggleLock,
  toggleGripper,
  toggleGripping,
  toggleGrabbable,
  updateGripOffset,
  duplicateShape,
  deleteShape,
  flattenGroup,
  groupShapes,
  ungroupShapes,
  subtractShapes,
  alignShapes,
  paths,
  attachToPath,
  detachFromPath,
  updatePathSpeed,
  toggleHole,
  updateColor,
  updateScale,
  updateRotation,
  motionController,
  updateMotion,
  groups,
  makeSelectedGroupJoint,
  updateSelectedGroupJointRotation,
  updateGroupJointRotationById,
  updateSelectedGroupPivot,
  updateSelectedGroupPivotShapeId,
  updateGroupMotion,
  setSelectedIds,
  motorGroups,
  createMotorGroup,
  updateMotorGroupShapes,
  updateMotorGroupMotion,
  deleteMotorGroup,
  updateMotorGroupPivot,
  updateMotorGroupAxis,
  updateMotorGroupLimits,
  updateTexture,
  updateShapePhysicsProperty,
}: ObjectTabProps) {
  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Circuit Studio — live simulation mirror */}
      <div style={{ marginBottom: '16px' }}>
        <CircuitSection
        circuitLinkOptions={circuitLinkOptions}
        cadStreamConnected={cadStreamConnected}
        liveSimulationFrame={liveSimulationFrame}
        primarySelected={primarySelected}
        setPrimaryCircuitNodeId={setPrimaryCircuitNodeId}
        lastCircuitStartPayload={lastCircuitStartPayload}
        unitMode={unitMode as "mm" | "cm"}
        streamHostLabel={streamHostLabel}
      />
      </div>

      {/* ── SELECTION INSPECTOR — always at the top when something is selected ── */}
      {selectedShapes.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <InspectorSection
          selectedShapes={selectedShapes}
          primarySelected={primarySelected}
          toggleLock={toggleLock}
          toggleGripper={toggleGripper}
          toggleGripping={toggleGripping}
          toggleGrabbable={toggleGrabbable}
          updateGripOffset={updateGripOffset}
          duplicateShape={duplicateShape}
          deleteShape={deleteShape}
          flattenGroup={flattenGroup}
          groupShapes={groupShapes}
          ungroupShapes={ungroupShapes}
          subtractShapes={subtractShapes}
          alignShapes={alignShapes}
          paths={paths}
          attachToPath={attachToPath}
          detachFromPath={detachFromPath}
          updatePathSpeed={updatePathSpeed}
          toggleHole={toggleHole}
          updateColor={updateColor}
          updateTexture={updateTexture}
          updateScale={updateScale}
          updateRotation={updateRotation}
          scale={scale}
          unitMode={unitMode}
          motorGroups={motorGroups}
          setSelectedIds={setSelectedIds}
          updateShapePhysicsProperty={updateShapePhysicsProperty}
        />
        </div>
      )}

      {/* Motion Controls for Joint / motor channel / linear controller */}
      {selectedShapes.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <MotionControlSection
          shapes={shapes}
          selectedShapes={selectedShapes}
          primarySelected={primarySelected}
          groups={groups}
          motionController={motionController}
          updateMotion={updateMotion}
          makeSelectedGroupJoint={makeSelectedGroupJoint}
          updateSelectedGroupJointRotation={updateSelectedGroupJointRotation}
          updateGroupJointRotationById={updateGroupJointRotationById}
          updateSelectedGroupPivot={updateSelectedGroupPivot}
          updateSelectedGroupPivotShapeId={updateSelectedGroupPivotShapeId}
          updateGroupMotion={updateGroupMotion}
          setSelectedIds={setSelectedIds}
          ungroupShapes={ungroupShapes}
          motorGroups={motorGroups}
          createMotorGroup={createMotorGroup}
          updateMotorGroupShapes={updateMotorGroupShapes}
          updateMotorGroupMotion={updateMotorGroupMotion}
          deleteMotorGroup={deleteMotorGroup}
          updateMotorGroupPivot={updateMotorGroupPivot}
          updateMotorGroupAxis={updateMotorGroupAxis}
          updateMotorGroupLimits={updateMotorGroupLimits}
        />
        </div>
      )}



      {/* ── ADD SHAPES — below the inspector so it doesn't push it off-screen ── */}
      <AddObjectsSection
        startPlacement={(payload) => {
          if (!payload) return;
          if (payload.kind === "glb") addGlbShape(payload.url);
          else addShape(payload.type);
        }}
        customAssets={customAssets}
        addCustomAsset={addCustomAsset}
        removeCustomAsset={removeCustomAsset}
      />

      {/* Empty State — only shown when nothing is selected */}
      {selectedShapes.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center p-8 bg-white/[0.01] border border-white/[0.04] rounded-2xl border-dashed mt-auto mb-4 animate-[slideIn_0.2s_ease] select-none">
          <div className="w-12 h-12 flex items-center justify-center bg-accent/8 border border-accent/15 text-indigo-400 rounded-xl mb-3.5 shadow-[0_0_16px_rgba(67,97,238,0.06),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <Box size={24} strokeWidth={1.5} />
          </div>
          <p className="text-xs text-text-muted font-normal leading-relaxed whitespace-normal" style={{ fontFamily: "sans-serif" }}>
            Click an object in the viewport
            <br />
            or add a new primitive below
          </p>
        </div>
      )}
    </div>
  );
}
