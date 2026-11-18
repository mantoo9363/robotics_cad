import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { TransformControls, Line } from "@react-three/drei";
import type { MotionPath } from "../../App";

type PathRendererProps = {
  path: MotionPath;
  paths: MotionPath[];
  isSelected: boolean;
  isAttached?: boolean;
  savePathsToHistory: (newPaths: MotionPath[]) => void;
  setPaths: any;
  activePathWP: number | null;
  setActivePathWP: any;
};

export default function PathRenderer({
  path,
  paths,
  isSelected,
  isAttached,
  savePathsToHistory,
  setPaths,
  activePathWP,
  setActivePathWP,
}: PathRendererProps) {
  const curve = useMemo(() => {
    if (path.points.length < 2) return null;
    const vectors = path.points.map((p) => new THREE.Vector3(...p));
    return new THREE.CatmullRomCurve3(vectors, path.closed);
  }, [path]);

  useEffect(() => {
    if (!isSelected) setActivePathWP(null);
  }, [isSelected, setActivePathWP]);

  return (
    <group>
      {curve && (
        <Line
          points={curve.getPoints(50)}
          color={isSelected ? "#4361ee" : "#84cc16"}
          lineWidth={2}
        />
      )}
      {isSelected &&
        path.points.map((pt, i) => (
          <group key={i}>
            <mesh
              position={pt}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!isAttached) setActivePathWP(i);
              }}
            >
              <sphereGeometry args={[0.2, 16, 16]} />
              <meshBasicMaterial
                color={
                  isAttached
                    ? "#64748b"
                    : activePathWP === i
                      ? "#fbbf24"
                      : "#f43f5e"
                }
              />
            </mesh>
            {!isAttached && activePathWP === i && (
              <TransformControls
                mode="translate"
                position={pt}
                size={0.8}
                onObjectChange={(e: any) => {
                  if (e?.target?.object) {
                    const pos = e.target.object.position;
                    setPaths((prev: any) =>
                      prev.map((p: any) => {
                        if (p.id !== path.id) return p;
                        const newPts = [...p.points];
                        newPts[i] = [pos.x, pos.y, pos.z];
                        return { ...p, points: newPts };
                      }),
                    );
                  }
                }}
                onMouseUp={() => {
                  savePathsToHistory(paths);
                }}
              />
            )}
          </group>
        ))}
    </group>
  );
}
