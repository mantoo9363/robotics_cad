import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ShapeType, MotionPath } from "../../App";

type AnimatedWrapperProps = {
  shape: ShapeType;
  path: MotionPath;
  children: React.ReactNode;
};

export default function AnimatedWrapper({
  shape,
  path,
  children,
}: AnimatedWrapperProps) {
  const curve = useMemo(() => {
    if (!path || path.points.length < 2) return null;
    const vectors = path.points.map((p) => new THREE.Vector3(...p));
    return new THREE.CatmullRomCurve3(vectors, path.closed);
  }, [path]);

  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ref.current || !curve) return;
    const speed = shape.pathSpeed ?? 0.1;
    const time = (state.clock.elapsedTime * speed) % 1;

    const t = time >= 0 ? time : 1 + time;
    const pos = curve.getPointAt(t);
    ref.current.position.copy(pos);

    const tNext = (t + 0.01) % 1;
    const nextPos = curve.getPointAt(tNext);
    ref.current.lookAt(nextPos);
  });

  if (!curve) return <>{children}</>;

  return <group ref={ref}>{children}</group>;
}
