import React from "react";
import { getCachedGeometry } from "../../lib/geometryCache";

export default function PrimitiveGeometry({ type }: { type?: string }) {
  return <primitive object={getCachedGeometry(type, "medium")} attach="geometry" />;
}
