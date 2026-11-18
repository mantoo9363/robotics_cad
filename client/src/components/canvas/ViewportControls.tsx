import React, { useState, useEffect } from "react";
import { Home, ZoomIn, ZoomOut, Maximize, Box, LayoutGrid, Lock, Unlock } from "lucide-react";
import ViewCube from "./ViewCube";

export default function ViewportControls() {
  const [isOrtho, setIsOrtho] = useState(false);
  const [isCameraLocked, setIsCameraLocked] = useState(false);

  const triggerEvent = (name: string) => {
    window.dispatchEvent(new CustomEvent(name));
  };

  const handleOrthoToggle = () => {
    setIsOrtho((prev) => !prev);
    triggerEvent("camera-ortho-toggle");
  };

  const handleLockToggle = () => {
    setIsCameraLocked((prev) => !prev);
    triggerEvent("camera-lock-toggle");
  };

  const btnClass =
    "w-9 h-9 flex items-center justify-center rounded-lg bg-slate-900/85 border border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800 transition-all duration-200 shadow-md pointer-events-auto cursor-pointer";

  return (
    <div className="flex flex-col gap-4 items-center select-none pointer-events-none">
      {/* 3D View Cube */}
      <div className="mb-2">
        <ViewCube />
      </div>

      {/* Camera Operation Buttons */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={() => triggerEvent("camera-reset")}
          className={btnClass}
          title="Home View"
        >
          <Home size={16} />
        </button>

        <button
          onClick={() => triggerEvent("camera-fit")}
          className={btnClass}
          title="Fit View"
        >
          <Maximize size={16} />
        </button>

        <button
          onClick={() => triggerEvent("camera-zoom-in")}
          className={btnClass}
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>

        <button
          onClick={() => triggerEvent("camera-zoom-out")}
          className={btnClass}
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>

        <button
          onClick={handleLockToggle}
          className={`${btnClass} ${isCameraLocked ? "text-indigo-400 border-indigo-500/40 bg-slate-800" : ""}`}
          title={
            isCameraLocked
              ? "Camera Locked — click to unlock (the view cube above still works)"
              : "Lock Camera"
          }
        >
          {isCameraLocked ? <Lock size={16} /> : <Unlock size={16} />}
        </button>

        {/* <button
          onClick={handleOrthoToggle}
          className={`${btnClass} ${isOrtho ? "text-indigo-400 border-indigo-500/40 bg-slate-800" : ""}`}
          title={isOrtho ? "Perspective View" : "Orthographic View"}
        >
          {isOrtho ? <Box size={16} /> : <LayoutGrid size={16} />}
        </button> */}
      </div>
    </div>
  );
}
