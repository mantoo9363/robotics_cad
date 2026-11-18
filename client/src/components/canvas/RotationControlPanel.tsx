import React, { useState, useRef, useEffect } from "react";
import type { ShapeType } from "../../App";

type RotationControlPanelProps = {
  selectedShapes: ShapeType[];
  selectedIds: number[];
  shapes: ShapeType[];
  initRotationDrag: () => void;
  applyRotationUpdate: (nextX: number, nextY: number, nextZ: number) => void;
  handleRotationDragEnd: (finalX: number, finalY: number, finalZ: number) => void;
  handleResetRotation: (callback: (x: number, y: number, z: number) => void) => void;
  setSelectedIds: (ids: number[]) => void;
};

export default function RotationControlPanel({
  selectedShapes,
  selectedIds,
  shapes,
  initRotationDrag,
  applyRotationUpdate,
  handleRotationDragEnd,
  handleResetRotation,
  setSelectedIds,
}: RotationControlPanelProps) {
  const [panelRotateX, setPanelRotateX] = useState(0);
  const [panelRotateY, setPanelRotateY] = useState(0);
  const [panelRotateZ, setPanelRotateZ] = useState(0);

  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (isDraggingRef.current) return;

    if (selectedIds.length === 1) {
      const s = shapes.find((x) => x.id === selectedIds[0]);
      if (s) {
        if (s.jointParentId !== undefined) {
          if (s.jointAxis === "xyz") {
            const jr = s.jointRotation || [0, 0, 0];
            setPanelRotateX(Math.round(jr[0]));
            setPanelRotateY(Math.round(jr[1]));
            setPanelRotateZ(Math.round(jr[2]));
          } else {
            const ja = s.jointAngle || 0;
            setPanelRotateX(s.jointAxis === "x" ? Math.round(ja) : 0);
            setPanelRotateY(s.jointAxis === "y" ? Math.round(ja) : 0);
            setPanelRotateZ(s.jointAxis === "z" ? Math.round(ja) : 0);
          }
        } else {
          const rx = Math.round((s.rotation[0] * 180) / Math.PI);
          const ry = Math.round((s.rotation[1] * 180) / Math.PI);
          const rz = Math.round((s.rotation[2] * 180) / Math.PI);
          setPanelRotateX(rx);
          setPanelRotateY(ry);
          setPanelRotateZ(rz);
        }
      }
    } else {
      setPanelRotateX(0);
      setPanelRotateY(0);
      setPanelRotateZ(0);
    }
  }, [selectedIds, shapes]);

  const isKinematicChild = selectedShapes.length === 1 && selectedShapes[0].jointParentId !== undefined;
  const singleShape = selectedShapes[0];

  const shouldShowXSlider =
    selectedShapes.length > 1 ||
    !isKinematicChild ||
    (isKinematicChild && (singleShape.jointAxis === "xyz" || singleShape.jointAxis === "x"));

  const shouldShowYSlider =
    selectedShapes.length > 1 ||
    !isKinematicChild ||
    (isKinematicChild && (singleShape.jointAxis === "xyz" || singleShape.jointAxis === "y"));

  const shouldShowZSlider =
    selectedShapes.length > 1 ||
    !isKinematicChild ||
    (isKinematicChild && (singleShape.jointAxis === "xyz" || singleShape.jointAxis === "z"));

  const onDragStart = () => {
    isDraggingRef.current = true;
    initRotationDrag();
  };

  const onDragChange = (axis: "x" | "y" | "z", val: number) => {
    // Keyboard-driven changes (arrow keys on a focused slider) fire onChange
    // without a preceding onMouseDown/onTouchStart, so the drag never got
    // initialized and applyRotationUpdate silently no-op'd. Lazily init it.
    if (!isDraggingRef.current) {
      onDragStart();
    }
    let nextX = panelRotateX;
    let nextY = panelRotateY;
    let nextZ = panelRotateZ;
    if (axis === "x") {
      nextX = val;
      setPanelRotateX(val);
    } else if (axis === "y") {
      nextY = val;
      setPanelRotateY(val);
    } else {
      nextZ = val;
      setPanelRotateZ(val);
    }
    applyRotationUpdate(nextX, nextY, nextZ);
  };

  const onDragEnd = () => {
    isDraggingRef.current = false;
    handleRotationDragEnd(panelRotateX, panelRotateY, panelRotateZ);
  };

  const onReset = () => {
    handleResetRotation((x, y, z) => {
      setPanelRotateX(x);
      setPanelRotateY(y);
      setPanelRotateZ(z);
    });
  };

  return (
    <div className="absolute bottom-6 left-6 z-20 w-72 bg-bg-panel/95 backdrop-blur-md border border-border-main/50 rounded-xl p-4 shadow-xl flex flex-col gap-4 animate-[slideIn_0.2s_ease]">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent tracking-wide uppercase">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Rotate Control
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {selectedShapes.length === 1
            ? `${selectedShapes[0].name || selectedShapes[0].type} (ID: ${selectedShapes[0].id})`
            : `${selectedShapes.length} Shapes Selected`}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {/* X Slider */}
        {shouldShowXSlider && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted font-medium">
                {isKinematicChild && singleShape.jointAxis !== "xyz" ? "Joint Angle" : "X Axis"}
              </span>
              <span className="text-text-main font-semibold tabular-nums">{panelRotateX}°</span>
            </div>
            <input
              type="range"
              className="rp-dim-slider w-full cursor-pointer"
              min="-180"
              max="180"
              value={panelRotateX}
              onMouseDown={onDragStart}
              onTouchStart={onDragStart}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                onDragChange("x", val);
              }}
              onMouseUp={onDragEnd}
              onTouchEnd={onDragEnd}
              onKeyUp={onDragEnd}
              onBlur={onDragEnd}
            />
          </div>
        )}

        {/* Y Slider */}
        {shouldShowYSlider && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted font-medium">
                {isKinematicChild && singleShape.jointAxis !== "xyz" ? "Joint Angle" : "Y Axis"}
              </span>
              <span className="text-text-main font-semibold tabular-nums">{panelRotateY}°</span>
            </div>
            <input
              type="range"
              className="rp-dim-slider w-full cursor-pointer"
              min="-180"
              max="180"
              value={panelRotateY}
              onMouseDown={onDragStart}
              onTouchStart={onDragStart}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                onDragChange("y", val);
              }}
              onMouseUp={onDragEnd}
              onTouchEnd={onDragEnd}
              onKeyUp={onDragEnd}
              onBlur={onDragEnd}
            />
          </div>
        )}

        {/* Z Slider */}
        {shouldShowZSlider && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted font-medium">
                {isKinematicChild && singleShape.jointAxis !== "xyz" ? "Joint Angle" : "Z Axis"}
              </span>
              <span className="text-text-main font-semibold tabular-nums">{panelRotateZ}°</span>
            </div>
            <input
              type="range"
              className="rp-dim-slider w-full cursor-pointer"
              min="-180"
              max="180"
              value={panelRotateZ}
              onMouseDown={onDragStart}
              onTouchStart={onDragStart}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                onDragChange("z", val);
              }}
              onMouseUp={onDragEnd}
              onTouchEnd={onDragEnd}
              onKeyUp={onDragEnd}
              onBlur={onDragEnd}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button className="flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center bg-white/5 border border-white/10 text-text-main hover:bg-white/10" onClick={onReset}>
          Reset
        </button>
        <button className="flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center bg-accent text-white hover:bg-accent/90 shadow-md shadow-accent/20" onClick={() => setSelectedIds([])}>
          Done
        </button>
      </div>
    </div>
  );
}
