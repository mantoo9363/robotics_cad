import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ShapeType } from "../../App";
import type { CircuitStreamFrame } from "../../lib/circuitStream";
import { getShapeMaterialProps } from "../../lib/materialUtils";

type ShapeMaterialProps = {
  shape: ShapeType;
  simulationData?:
    | CircuitStreamFrame
    | { emissive?: string; emissiveIntensity?: number }
    | null;
  defaultRoughness?: number;
  defaultMetalness?: number;
  side?: THREE.Side;
};

// Shared across every ShapeMaterial instance, same rationale as
// glbThumbnailRenderer.ts's singleton renderer — one loader, not one per
// shape.
const textureLoader = new THREE.TextureLoader();

export default React.memo(function ShapeMaterial({
  shape,
  simulationData,
  defaultRoughness = 0.2,
  defaultMetalness = 0.1,
  side,
}: ShapeMaterialProps) {
  const { color, ...rest } = getShapeMaterialProps(
    shape,
    simulationData,
    defaultRoughness,
    defaultMetalness,
  );

  // Holes always render with the fixed translucent hole material
  // (getShapeMaterialProps already ignores shape.color for them) — a
  // texture map would be equally pointless there.
  const texturePath = shape.isHole ? undefined : shape.texturePath;
  const [map, setMap] = useState<THREE.Texture | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    if (!texturePath) {
      setMap(null);
      return;
    }
    let disposed = false;
    const texture = textureLoader.load(texturePath, (loaded) => {
      if (disposed) return;
      // Textures default to no color-space tag; without this an albedo/color
      // map renders washed out against this app's other (already
      // color-managed) materials.
      loaded.colorSpace = THREE.SRGBColorSpace;
      // Disable mipmapping so a busy, multi-color image (a palette/colormap
      // grid, a detailed texture) doesn't get minified down to what looks
      // like a single averaged "majority color" once the shape is anything
      // but full-screen — WebGL auto-selects a coarser mip level as an
      // object shrinks on screen, and mip generation for a
      // high-contrast/high-frequency image averages exactly the kind of
      // detail this app's textures need to stay visible. The tradeoff is
      // some aliasing/shimmer at a distance instead — preferable to the
      // texture silently looking like flat plain color.
      loaded.generateMipmaps = false;
      loaded.minFilter = THREE.LinearFilter;
      setMap(loaded);
    });
    return () => {
      disposed = true;
      texture.dispose();
      // Drop the reference to the now-disposed texture immediately rather
      // than waiting for the next `texturePath` to resolve — otherwise the
      // material would keep pointing at freed GPU memory for however long
      // the next load takes.
      setMap(null);
    };
  }, [texturePath]);

  // Imperative, not a declarative `map={map}` JSX prop: MeshStandardMaterial
  // compiles its shader with #define USE_MAP only if `map` was non-null at
  // compile time. R3F reuses the same material instance across re-renders
  // (no key change here), so flipping `map` from null to a Texture via a
  // plain prop update silently does nothing without `needsUpdate = true` —
  // this is exactly the mechanism GlbShapeMesh.tsx's own material-sync
  // effect already uses, and the one place in this component that must run
  // as an effect on the live material instance rather than through JSX
  // props, so a texture added to an already-mounted shape (not just one
  // that mounts with texturePath already set) actually shows up.
  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.map = map;
    materialRef.current.needsUpdate = true;
  }, [map]);

  return (
    <meshStandardMaterial
      ref={materialRef}
      key={shape.isHole ? "hole" : "solid"}
      attach="material"
      // A loaded map should show its own colors, not be tinted by whatever
      // shape.color happens to be — same reasoning as the vertexColors
      // white-base-color path just below it in getShapeMaterialProps.
      color={map ? "#ffffff" : color}
      {...rest}
      side={side ?? rest.side}
    />
  );
});
