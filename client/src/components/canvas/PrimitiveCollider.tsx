import React from "react";
import {
  CuboidCollider,
  BallCollider,
  CylinderCollider,
  ConeCollider,
  TrimeshCollider,
  ConvexHullCollider,
} from "@react-three/rapier";

export type PrimitiveColliderProps = {
  col: {
    type: string;
    args: any;
    position?: [number, number, number];
    rotation?: [number, number, number];
  };
  mass: number;
  friction: number;
  restitution: number;
};

export default function PrimitiveCollider({
  col,
  mass,
  friction,
  restitution,
}: PrimitiveColliderProps) {
  switch (col.type) {
    case "cuboid":
      return (
        <CuboidCollider
          args={col.args as [number, number, number]}
          position={col.position}
          rotation={col.rotation}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      );
    case "ball":
      return (
        <BallCollider
          args={col.args as [number]}
          position={col.position}
          rotation={col.rotation}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      );
    case "cylinder":
      return (
        <CylinderCollider
          args={col.args as [number, number]}
          position={col.position}
          rotation={col.rotation}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      );
    case "cone":
      return (
        <ConeCollider
          args={col.args as [number, number]}
          position={col.position}
          rotation={col.rotation}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      );
    case "trimesh":
      return (
        <TrimeshCollider
          args={col.args as [Float32Array, Uint32Array]}
          position={col.position}
          rotation={col.rotation}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      );
    case "hull":
      return (
        <ConvexHullCollider
          args={col.args as [Float32Array]}
          position={col.position}
          rotation={col.rotation}
          mass={mass}
          friction={friction}
          restitution={restitution}
        />
      );
    default:
      return null;
  }
}
