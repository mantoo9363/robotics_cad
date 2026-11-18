import React, { useEffect, useState, useRef, useCallback } from "react";

export default function ViewCube() {
  const [rotation, setRotation] = useState({ x: 45, y: 45 });
  const dragStart = useRef({ x: 0, y: 0 });
  // Separate from dragStart: dragStart moves every pointer move (it's the
  // per-frame delta reference), so it can't also answer "did the pointer
  // move far enough overall to count as a drag rather than a click" — that
  // needs a reference that stays fixed at the original pointerdown.
  const dragOrigin = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const wasDragged = useRef(false);

  useEffect(() => {
    const handleRotation = (e: Event) => {
      const { x, y } = (e as CustomEvent).detail;
      setRotation({
        x: (x * 180) / Math.PI,
        y: (y * 180) / Math.PI,
      });
    };
    window.addEventListener("camera-rotation-change", handleRotation);
    return () => window.removeEventListener("camera-rotation-change", handleRotation);
  }, []);

  const handleFaceClick = useCallback((face: string) => {
    if (wasDragged.current) return;
    window.dispatchEvent(new CustomEvent("camera-snap", { detail: face }));
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    wasDragged.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (dx === 0 && dy === 0) return;
    // Dispatch this move's delta immediately rather than waiting for it to
    // cross a threshold — the old version only fired once accumulated
    // movement passed 4px *per event*, which silently dropped every slower,
    // finer drag movement on the floor (needed a lot of dragging to see
    // anything happen). wasDragged (below) still gets its own threshold, so
    // a genuine click on a face isn't treated as a drag by a stray pixel of
    // jitter.
    dragStart.current = { x: e.clientX, y: e.clientY };
    const totalDx = e.clientX - dragOrigin.current.x;
    const totalDy = e.clientY - dragOrigin.current.y;
    if (Math.abs(totalDx) > 4 || Math.abs(totalDy) > 4) {
      wasDragged.current = true;
    }
    window.dispatchEvent(new CustomEvent("camera-orbit", { detail: { dx, dy } }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const cubeStyle = {
    transform: `rotateX(${-rotation.x}deg) rotateY(${rotation.y}deg)`,
  };

  const faceClass =
    "absolute w-full h-full bg-slate-800/90 border border-slate-700/80 text-[10px] font-bold text-slate-300 flex items-center justify-center transition-all duration-200 select-none hover:bg-indigo-600/95 hover:text-white hover:border-indigo-400 cursor-pointer shadow-[inset_0_0_8px_rgba(0,0,0,0.4)]";

  return (
    <div
      className="relative w-16 h-16 [perspective:300px] select-none pointer-events-auto touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className="w-full h-full relative [transform-style:preserve-3d] transition-transform duration-75 ease-out"
        style={cubeStyle}
      >
        <div
          onClick={() => handleFaceClick("front")}
          className={`${faceClass} [transform:translateZ(32px)]`}
        >
          FRONT
        </div>
        <div
          onClick={() => handleFaceClick("back")}
          className={`${faceClass} [transform:rotateY(180deg)_translateZ(32px)]`}
        >
          BACK
        </div>
        <div
          onClick={() => handleFaceClick("left")}
          className={`${faceClass} [transform:rotateY(-90deg)_translateZ(32px)]`}
        >
          LEFT
        </div>
        <div
          onClick={() => handleFaceClick("right")}
          className={`${faceClass} [transform:rotateY(90deg)_translateZ(32px)]`}
        >
          RIGHT
        </div>
        <div
          onClick={() => handleFaceClick("top")}
          className={`${faceClass} [transform:rotateX(90deg)_translateZ(32px)]`}
        >
          TOP
        </div>
        <div
          onClick={() => handleFaceClick("bottom")}
          className={`${faceClass} [transform:rotateX(-90deg)_translateZ(32px)]`}
        >
          BOTTOM
        </div>
      </div>
    </div>
  );
}
