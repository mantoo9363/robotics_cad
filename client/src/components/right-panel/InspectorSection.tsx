import React from "react";
import type { ShapeType, MotionPath, MotorGroup } from "../../App";
import { getShapeBaseSize } from "../../lib/shapeDimensions";
import { MAX_SHAPE_MASS } from "../../lib/physicsUtils";

type InspectorSectionProps = {
  selectedShapes: ShapeType[];
  primarySelected: ShapeType | null;
  toggleLock: () => void;
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
  updateTexture: (texturePath: string | null) => void;
  updateScale: (axis: number, value: number) => void;
  updateRotation: (axis: number, value: number) => void;
  unitMode: string;
  scale: string;
  motorGroups: MotorGroup[];
  setSelectedIds: (ids: number[]) => void;
  toggleGripper: () => void;
  toggleGripping: () => void;
  toggleGrabbable: () => void;
  updateGripOffset: (axis: number, value: number) => void;
  updateShapePhysicsProperty: (
    id: number,
    key:
      | "friction"
      | "restitution"
      | "fixedRotation"
      | "mass"
      | "collisionDisabled"
      | "name",
    value: any,
  ) => void;
};

export function InspectorSection({
  selectedShapes,
  primarySelected,
  toggleLock,
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
  updateTexture,
  updateScale,
  updateRotation,
  unitMode,
  scale,
  motorGroups,
  setSelectedIds,
  toggleGripper,
  toggleGripping,
  toggleGrabbable,
  updateGripOffset,
  updateShapePhysicsProperty,
}: InspectorSectionProps) {
  const [localName, setLocalName] = React.useState(primarySelected?.name || "");

  React.useEffect(() => {
    setLocalName(primarySelected?.name || "");
  }, [primarySelected?.id, primarySelected?.name]);

  const hasMotorGroupShape = selectedShapes.some((s) =>
    motorGroups.some((mg) => mg.shapeIds.includes(s.id)),
  );

  const isLocked = !!primarySelected?.isLocked;

  return (
    <div
      className={`bg-white/[0.02] border rounded-[14px] overflow-hidden shadow-2xl overflow-y-scroll transition-colors duration-300 ${
        isLocked ? "border-rose-500/35" : "border-indigo-500/25"
      }`}
    >
      <div
        className={`py-3 px-3.5 flex items-center justify-between border-b transition-colors duration-300 ${
          isLocked
            ? "bg-rose-500/8 border-rose-500/12"
            : "bg-accent/8 border-accent/12"
        }`}
      >
        <div className="flex items-center gap-2 text-[0.72rem] font-bold text-slate-200 uppercase tracking-wider">
          <div
            className={`w-2 h-2 rounded-full animate-pulse transition-all duration-300 ${
              isLocked
                ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                : "bg-accent shadow-[0_0_8px_rgba(67,97,238,0.6)]"
            }`}
          />
          <span>
            {selectedShapes.length === 1
              ? primarySelected?.type === "custom"
                ? " Object"
                : primarySelected?.type?.toUpperCase()
              : `${selectedShapes.length} Objects`}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            className="w-5 h-5 flex items-center justify-center rounded-lg border cursor-pointer transition-all duration-200 text-slate-400 border-white/8 bg-white/5 hover:enabled:bg-white/10 hover:enabled:text-slate-200 hover:enabled:border-white/15 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => setSelectedIds([])}
            title="Deselect All"
          >
            <svg
              width="14"  
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <button
            className={`w-5 h-5 flex items-center justify-center rounded-lg border cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${
              isLocked
                ? "bg-rose-500/10 border-rose-500/20 text-rose-400 hover:enabled:bg-rose-500/20"
                : "text-slate-400 border-white/8 bg-white/5 hover:enabled:bg-white/10 hover:enabled:text-slate-200"
            }`}
            onClick={toggleLock}
            title={isLocked ? "Unlock" : "Lock"}
          >
            {isLocked ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded-lg border cursor-pointer transition-all duration-200 text-slate-400 border-white/8 bg-white/5 hover:enabled:bg-white/10 hover:enabled:text-slate-200 hover:enabled:border-white/15 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={duplicateShape}
            disabled={isLocked}
            title="Duplicate"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded-lg border cursor-pointer transition-all duration-200 border-white/8 bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed text-red-400 hover:enabled:bg-red-500/15 hover:enabled:border-red-500/30 hover:enabled:text-red-300"
            onClick={deleteShape}
            disabled={isLocked}
            title="Delete"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {selectedShapes.length === 1 && primarySelected && (
        <div className="p-3.5 border-b border-white/[0.04]">
          <label
            htmlFor="inspector-shape-name"
            className="block text-[0.6rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5"
          >
            Name
          </label>
          <input
            id="inspector-shape-name"
            type="text"
            className="w-full bg-black/20 border border-white/10 rounded-lg py-2 px-3 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
            placeholder={
              primarySelected.type === "custom"
                ? "Custom Object"
                : primarySelected.type.charAt(0).toUpperCase() +
                  primarySelected.type.slice(1)
            }
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => {
              const trimmed = localName.trim();
              if (trimmed.length > 0) {
                updateShapePhysicsProperty(
                  primarySelected.id,
                  "name",
                  trimmed,
                );
              } else {
                const defaultName =
                  primarySelected.type === "custom"
                    ? "Custom Object"
                    : primarySelected.type.charAt(0).toUpperCase() +
                      primarySelected.type.slice(1);
                setLocalName(defaultName);
                updateShapePhysicsProperty(
                  primarySelected.id,
                  "name",
                  defaultName,
                );
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      )}

      {hasMotorGroupShape && (
        <div className="animate-[slideIn_0.3s_ease] bg-indigo-500/8 border border-indigo-500/25 rounded-lg p-2 mx-2.5 mb-3 text-[10px] text-indigo-200 text-center">
          Motor group operations disabled
        </div>
      )}

      {/* CSG Actions */}
      {selectedShapes.length > 1 &&
        selectedShapes.every(
          (s) => s.parentId && s.parentId === selectedShapes[0].parentId,
        ) && (
          <div className="p-3.5 border-t border-white/[0.04]">
            <button
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={flattenGroup}
              disabled={hasMotorGroupShape}
            >
              Save as New Object
            </button>
          </div>
        )}

      {selectedShapes.length > 1 && (
        <div className="p-3.5 border-t border-white/[0.04]">
          <div className="flex flex-col gap-2 mb-3">
            <button
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={groupShapes}
              disabled={hasMotorGroupShape || selectedShapes.some((s) => s.isLocked)}
            >
              Add
            </button>
            {selectedShapes.some((s) => s.parentId) && (
              <button
                className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer bg-emerald-500/8 border border-emerald-500/20 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={ungroupShapes}
                disabled={hasMotorGroupShape}
              >
                Ungroup
              </button>
            )}
            <button
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={subtractShapes}
              disabled={hasMotorGroupShape || selectedShapes.some((s) => s.isLocked)}
            >
              Subtract
            </button>
          </div>
          <div
            className={`flex items-center gap-2 mb-3 ${hasMotorGroupShape ? "opacity-50" : ""}`}
          >
            <div className="text-[0.6rem] font-bold uppercase tracking-wider text-slate-500 mb-0 flex-none">
              Align
            </div>
            {["x", "y", "z"].map((axis) => (
              <button
                key={axis}
                className="flex-1 py-1.5 px-3 rounded-lg bg-white/5 border border-white/8 text-slate-300 text-xs font-semibold hover:bg-white/10 hover:border-white/15 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => alignShapes(axis as "x" | "y" | "z")}
                disabled={hasMotorGroupShape}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Subtract order hint */}
          {!hasMotorGroupShape && (
            <div className="bg-red-500/8 border border-red-500/20 rounded-lg p-2 text-[10px] text-slate-200">
              <div className="font-semibold mb-1 text-slate-100">
                First selected = BASE, rest = CUTTERS
              </div>
            </div>
          )}
        </div>
      )}

      {selectedShapes.length === 1 && primarySelected?.parentId && (
        <div className="p-3.5 border-t border-white/[0.04] animate-[slideIn_0.3s_ease]">
          <button
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-transparent border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={ungroupShapes}
            disabled={hasMotorGroupShape}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Ungroup
          </button>
        </div>
      )}

      {/* Path Attachment */}
      {selectedShapes.length > 0 &&
        paths.length > 0 &&
        !primarySelected?.isHole && (
          <div className="p-3.5 border-t border-white/[0.04]">
            <div className="text-[0.6rem] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
              Motion Path
            </div>
            <div className="flex gap-2 flex-wrap">
              {primarySelected?.pathId ? (
                (() => {
                  const attachedPath = paths.find((p) => p.id === primarySelected.pathId);
                  const attachedPathName = attachedPath
                    ? (attachedPath.name || `Path ${attachedPath.id.toString().slice(-4)}`)
                    : `Path ${primarySelected.pathId.toString().slice(-4)}`;
                  return (
                    <div className="w-full flex flex-col gap-3">
                      <button
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-red-600 border border-red-600 text-white hover:bg-red-700"
                        onClick={detachFromPath}
                      >
                        Detach {attachedPathName}
                      </button>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">Speed</span>
                        <input
                          type="number"
                          min="0"
                          max="3"
                          step="0.05"
                          className="w-20 bg-black/20 border border-white/10 rounded px-1.5 py-0.5 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500"
                          value={primarySelected.pathSpeed ?? 1}
                          onChange={(e) => updatePathSpeed(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-col gap-2 mb-3 w-full">
                  {paths.map((p) => (
                    <button
                      key={p.id}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-xs cursor-pointer transition-all duration-200 bg-transparent border border-white/10 text-slate-300 hover:bg-white/5"
                      onClick={() => attachToPath(p.id)}
                    >
                      Attach to {p.name || `Path ${p.id.toString().slice(-4)}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      <div className="p-3.5 border-t border-white/[0.04]">
        <div className="grid grid-cols-2 gap-2 bg-black/20 p-1 rounded-lg">
          <button
            className={`flex items-center justify-center gap-2 py-2 rounded-md font-semibold text-xs border border-transparent cursor-pointer transition-all duration-200 ${
              !primarySelected?.isHole
                ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"
                : "bg-transparent text-slate-500 hover:text-slate-400"
            }`}
            onClick={() => primarySelected?.isHole && toggleHole()}
          >
            <span
              className={`w-2 h-2 rounded-full ${!primarySelected?.isHole ? "bg-indigo-500" : "bg-slate-600"}`}
            />
            Solid
          </button>
          <button
            className={`flex items-center justify-center gap-2 py-2 rounded-md font-semibold text-xs border border-transparent cursor-pointer transition-all duration-200 ${
              primarySelected?.isHole
                ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                : "bg-transparent text-slate-500 hover:text-slate-400"
            }`}
            onClick={() => !primarySelected?.isHole && toggleHole()}
          >
            <span
              className={`w-2 h-2 rounded-full ${primarySelected?.isHole ? "bg-amber-500" : "bg-slate-600"}`}
            />
            Hole
          </button>
        </div>
      </div>

      {selectedShapes.length === 1 && primarySelected && (
        <div className="p-3.5 border-t border-white/[0.04]">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">Mass (kg)</span>
              <input
                type="number"
                min="0.001"
                max={MAX_SHAPE_MASS}
                step="0.1"
                className="w-20 bg-black/20 border border-white/10 rounded px-1.5 py-0.5 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500"
                value={
                  primarySelected.mass !== undefined
                    ? primarySelected.mass
                    : 1.0
                }
                onChange={(e) =>
                  updateShapePhysicsProperty(
                    primarySelected.id,
                    "mass",
                    Math.min(MAX_SHAPE_MASS, Math.max(0.001, Number(e.target.value))),
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">Friction</span>
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                className="w-20 bg-black/20 border border-white/10 rounded px-1.5 py-0.5 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500"
                value={
                  primarySelected.friction !== undefined
                    ? primarySelected.friction
                    : 0.5
                }
                onChange={(e) =>
                  updateShapePhysicsProperty(
                    primarySelected.id,
                    "friction",
                    Number(e.target.value),
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">Bounciness</span>
              <input
                type="number"
                min="0"
                max="10"
                step="0.05"
                className="w-20 bg-black/20 border border-white/10 rounded px-1.5 py-0.5 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500"
                value={
                  primarySelected.restitution !== undefined
                    ? primarySelected.restitution
                    : 0.2
                }
                onChange={(e) =>
                  updateShapePhysicsProperty(
                    primarySelected.id,
                    "restitution",
                    Math.min(10, Math.max(0, Number(e.target.value))),
                  )
                }
              />
            </div>
            {/* <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={!!primarySelected.fixedRotation}
                onChange={(e) =>
                  updateShapePhysicsProperty(
                    primarySelected.id,
                    "fixedRotation",
                    e.target.checked,
                  )
                }
              />
              Lock Rotation
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={!!primarySelected.collisionDisabled}
                onChange={(e) =>
                  updateShapePhysicsProperty(
                    primarySelected.id,
                    "collisionDisabled",
                    e.target.checked,
                  )
                }
              />
              No Collisions
            </label> */}
          </div>
        </div>
      )}

      {/* {primarySelected && (
        <div className="p-2.5 mx-3.5 mb-3 bg-indigo-500/[0.03] border border-indigo-500/15 rounded-lg">
          <div className="text-[0.6rem] font-bold uppercase tracking-wider mb-2 text-indigo-300">
            Grabbing
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={!!primarySelected.isGripper}
                onChange={toggleGripper}
                disabled={isLocked}
              />
              Is Gripper
            </label>
            {primarySelected.isGripper && (
              <>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={!!primarySelected.isGripping}
                    onChange={toggleGripping}
                    disabled={isLocked}
                  />
                  Grip / Close Claws
                </label>
                <div className="ml-4 mt-1">
                  <div className="text-[10px] text-slate-400 font-bold mb-1.5 tracking-wider uppercase">
                    Grip Offset
                  </div>
                  {[
                    { label: "X", idx: 0, colorClass: "bg-red-500/10 text-red-400 border-red-500/20" },
                    { label: "Y", idx: 2, colorClass: "bg-green-500/10 text-green-400 border-green-500/20" },
                    { label: "Z", idx: 1, colorClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" }
                  ].map(({ label, idx, colorClass }) => (
                    <div key={label} className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold w-5.5 text-center rounded py-0.5 border ${colorClass}`}>
                        {label}
                      </span>
                      <input
                        className="w-16 bg-white/5 border border-white/8 rounded px-1.5 py-0.5 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                        type="number"
                        step={0.1}
                        value={Number(
                          (primarySelected.gripOffset || [0, 0, 0])[idx].toFixed(2)
                        )}
                        onChange={(e) =>
                          updateGripOffset(idx, Number(e.target.value))
                        }
                        disabled={isLocked}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={!!primarySelected.grabbable}
                onChange={toggleGrabbable}
                disabled={isLocked}
              />
              Is Grabbable
            </label>
          </div>
        </div>
      )} */}

      {/* Color */}
      {selectedShapes.length > 0 && (
        <div className="p-3.5 border-t border-white/[0.04]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-300">Color</span>
            <div className="flex items-center gap-3">
              <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-white/10 cursor-pointer">
                <input
                  type="color"
                  className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full"
                  value={
                    selectedShapes.find((s) => !s.isHole)?.color ??
                    primarySelected?.color ??
                    "#ffffff"
                  }
                  onChange={(e) => updateColor(e.target.value)}
                  disabled={isLocked}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      selectedShapes.find((s) => !s.isHole)?.color ??
                      primarySelected?.color ??
                      "#ffffff",
                  }}
                />
              </div>
              <span className="font-mono text-xs text-slate-400">
                {(
                  selectedShapes.find((s) => !s.isHole)?.color ??
                  primarySelected?.color ??
                  "#ffffff"
                ).toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Texture Map */}
      {selectedShapes.length > 0 && (
        <div className="p-3.5 border-t border-white/[0.04]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-300">Texture</span>
            <div className="flex items-center gap-2">
              <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-white/10 cursor-pointer bg-black/20">
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    // No backend to upload to — store as a data URL, same
                    // approach modelService.ts's uploadModel uses for GLBs
                    // (see BUG-043).
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === "string") updateTexture(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                  disabled={isLocked}
                />
                {(selectedShapes.find((s) => !s.isHole)?.texturePath ??
                  primarySelected?.texturePath) ? (
                  <img
                    src={
                      selectedShapes.find((s) => !s.isHole)?.texturePath ??
                      primarySelected?.texturePath
                    }
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs pointer-events-none">
                    +
                  </div>
                )}
              </div>
              {(selectedShapes.find((s) => !s.isHole)?.texturePath ??
                primarySelected?.texturePath) && (
                <button
                  onClick={() => updateTexture(null)}
                  disabled={isLocked}
                  className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer border-0 bg-transparent"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dimensions & Rotation — side by side to save vertical space */}
      {primarySelected && (
        <div className="p-3.5 border-t border-white/[0.04] grid grid-cols-2 gap-x-3">
          {/* Dimensions column */}
          <div className="min-w-0">
            <div className="text-[0.6rem] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
              Dimensions
            </div>
            {[
              { label: "W", idx: 0, colorClass: "bg-red-500/10 text-red-400 border-red-500/20" },
              { label: "D", idx: 2, colorClass: "bg-green-500/10 text-green-400 border-green-500/20" },
              { label: "H", idx: 1, colorClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" }
            ].map(({ label, idx, colorClass }) => {
              const base = getShapeBaseSize(primarySelected)[idx];
              const dim = primarySelected.scale[idx] * base;

              // Physically-correct mm -> display-unit conversion, so
              // (shown number) x (unit) always equals the true mm size.
              // mm ÷1, cm ÷10, m ÷1000.
              let unitLabel = "mm";
              let unitDivisor = 1;
              if (scale === "1:10") {
                unitLabel = "cm";
                unitDivisor = 10;
              } else if (scale === "1:100" || scale === "1:1000") {
                unitLabel = "m";
                unitDivisor = 1000;
              }

              return (
                <div key={label} className="flex items-center gap-1.5 mb-1.5">
                  <span className={`text-[10px] font-bold w-5 shrink-0 text-center rounded py-0.5 border ${colorClass}`}>
                    {label}
                  </span>
                  <input
                    className="min-w-0 flex-1 bg-white/5 border border-white/8 rounded px-1 py-1 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={Number(
                      (dim / unitDivisor).toFixed(unitLabel === "m" ? 3 : 1),
                    )}
                    onChange={(e) => {
                      const val = Math.max(0.1, Number(e.target.value));
                      const newDim = val * unitDivisor;
                      updateScale(idx, newDim / base);
                    }}
                    disabled={isLocked}
                  />
                  <span className="text-[9px] text-slate-400 shrink-0 w-4">
                    {unitLabel}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Rotation column */}
          <div className="min-w-0">
            <div className="text-[0.6rem] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
              Rotation
            </div>
            {[
              { label: "X", idx: 0, colorClass: "bg-red-500/10 text-red-400 border-red-500/20" },
              { label: "Y", idx: 2, colorClass: "bg-green-500/10 text-green-400 border-green-500/20" },
              { label: "Z", idx: 1, colorClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" }
            ].map(({ label, idx, colorClass }) => (
              <div key={label} className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-[10px] font-bold w-5 shrink-0 text-center rounded py-0.5 border ${colorClass}`}>
                  {label}
                </span>
                <input
                  className="min-w-0 flex-1 bg-white/5 border border-white/8 rounded px-1 py-1 text-slate-200 text-xs text-right focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                  type="number"
                  value={Number(
                    (primarySelected.rotation[idx] * (180 / Math.PI)).toFixed(0),
                  )}
                  onChange={(e) =>
                    updateRotation(idx, Number(e.target.value) * (Math.PI / 180))
                  }
                  disabled={isLocked}
                />
                <span className="text-[9px] text-slate-400 shrink-0 w-4">
                  deg
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
