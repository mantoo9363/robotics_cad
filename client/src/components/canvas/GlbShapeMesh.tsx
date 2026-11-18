import React, { useRef, useMemo, useEffect, useState, Suspense } from "react";
import * as THREE from "three";
import { useGLTF, Edges } from "@react-three/drei";
import type { ShapeType } from "../../App";
import type { CircuitStreamFrame } from "../../lib/circuitStream";
import { getShapeMaterialProps } from "../../lib/materialUtils";
import { registerDisposer } from "../../lib/useGPUCleanup";

type GlbShapeMeshProps = {
  shape: ShapeType;
  isSelected?: boolean;
  simulationFrame?: CircuitStreamFrame | null;
  onLoaded?: (baseSize: [number, number, number]) => void;
  [key: string]: any;
};

// Shared across every GlbShapeMesh instance, same rationale as
// ShapeMaterial.tsx's own loader (and glbThumbnailRenderer.ts's singleton
// renderer): one loader, not one per shape.
const textureLoader = new THREE.TextureLoader();

const GlbShapeMesh = React.forwardRef<THREE.Group, GlbShapeMeshProps>(
  ({ shape, isSelected, simulationFrame, onLoaded, ...props }, ref) => {
    const gltf = useGLTF(shape.url || "") as any;
    const scene = gltf.scene;

    // GLB shapes render through their own cloned-material path below
    // (imperative mutation + needsUpdate, not <ShapeMaterial>'s declarative
    // JSX props), so the texture-map support ShapeMaterial.tsx has doesn't
    // reach GLB shapes at all — this is that same support, wired in here.
    const texturePath = shape.isHole ? undefined : shape.texturePath;
    const [map, setMap] = useState<THREE.Texture | null>(null);

    useEffect(() => {
      if (!texturePath) {
        setMap(null);
        return;
      }
      let disposed = false;
      const texture = textureLoader.load(texturePath, (loaded) => {
        if (disposed) return;
        loaded.colorSpace = THREE.SRGBColorSpace;
        // Same reasoning as ShapeMaterial.tsx: disable mipmapping so a
        // busy, multi-color texture doesn't get minified into what looks
        // like a single flat "majority color" once the model is small on
        // screen.
        loaded.generateMipmaps = false;
        loaded.minFilter = THREE.LinearFilter;
        setMap(loaded);
      });
      return () => {
        disposed = true;
        texture.dispose();
        setMap(null);
      };
    }, [texturePath]);

    const { wrapper, rawSize } = useMemo(() => {
      const c = scene.clone(true);
      c.traverse((node: any) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          if (mesh.material) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mesh.material = mat.clone();
            
            // Store original values to restore them later
            mesh.userData.originalColor = mat.color ? mat.color.clone() : null;
            mesh.userData.originalTransparent = mat.transparent;
            mesh.userData.originalOpacity = mat.opacity;
            mesh.userData.originalDepthWrite = mat.depthWrite;
          }
        }
      });
      const box = new THREE.Box3().setFromObject(c);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const sf = maxDim > 0 ? 1.0 / maxDim : 1.0;

      const w = new THREE.Group();
      c.position.set(-center.x, -center.y, -center.z);
      w.scale.setScalar(sf);
      w.add(c);

      return {
        wrapper: w,
        rawSize: [size.x * sf, size.y * sf, size.z * sf] as [number, number, number],
        scaleFactor: sf,
      };
    }, [scene]);

    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;
    const reportedRef = useRef(false);

    useEffect(() => {
      reportedRef.current = false;
    }, [scene]);

    useEffect(() => {
      if (!reportedRef.current && onLoadedRef.current) {
        reportedRef.current = true;
        onLoadedRef.current(rawSize);
      }
    }, [rawSize]);

    // Cheap synchronous math, recomputed each render (including on every
    // streamed simulationFrame). The two effects below key on its primitive
    // OUTPUTS, not on `simulationFrame`'s identity, so a stream frame that
    // doesn't actually change this shape's material triggers no wrapper
    // traversal.
    const matProps = useMemo(
      () => getShapeMaterialProps(shape, simulationFrame, 0.3, 0.1),
      [shape, simulationFrame],
    );
    // A loaded map should show its own colors, not be tinted by shape.color —
    // same convention as ShapeMaterial.tsx.
    const effectiveColor = map ? "#ffffff" : matProps.color;

    // Structural / shader-affecting props: shadows, texture map, blend state,
    // material params. These flip a `#define` (map, vertexColors) or a
    // pipeline flag, so they carry `needsUpdate = true` — but they only
    // change when the shape's own fields or the texture change, never per
    // stream frame.
    useEffect(() => {
      wrapper.traverse((node: any) => {
        if (!(node as THREE.Mesh).isMesh) return;
        const mesh = node as THREE.Mesh;
        mesh.castShadow = !shape.isHole;
        mesh.receiveShadow = !shape.isHole;
        const mat = mesh.material as any;
        if (!mat) return;
        mat.map = map;
        // GLTFLoader turns this on automatically whenever a mesh ships a
        // COLOR_0 attribute (some Sketchfab downloads bake per-vertex color
        // instead of, or in addition to, a texture). Left on, the shader
        // multiplies material.color by that vertex color, so a shape stays
        // tinted by its baked colors even after map is stripped and color is
        // set below.
        mat.vertexColors = false;
        mat.transparent = matProps.transparent;
        mat.opacity = matProps.opacity;
        mat.depthWrite = matProps.depthWrite;
        mat.side = matProps.side;
        mat.roughness = matProps.roughness;
        mat.metalness = matProps.metalness;
        mat.needsUpdate = true;
      });
    }, [
      wrapper,
      map,
      shape.isHole,
      matProps.transparent,
      matProps.opacity,
      matProps.depthWrite,
      matProps.side,
      matProps.roughness,
      matProps.metalness,
    ]);

    // Colour + emissive glow: plain uniform writes (no `needsUpdate`), and
    // keyed on the resolved string/number values. During a live circuit
    // stream this is the only one that re-runs, and only on the frames where
    // the glow or LED colour actually changed.
    useEffect(() => {
      wrapper.traverse((node: any) => {
        if (!(node as THREE.Mesh).isMesh) return;
        const mat = (node as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (!mat) return;
        if (mat.color) mat.color.set(effectiveColor);
        if (mat.emissive) {
          mat.emissive.set(matProps.emissive);
          mat.emissiveIntensity = matProps.emissiveIntensity;
        }
      });
    }, [wrapper, effectiveColor, matProps.emissive, matProps.emissiveIntensity]);

    useEffect(() => {
      // Disposes ONLY the materials, never the geometry.
      //
      // `scene.clone(true)` deep-copies the node graph, but three.js's
      // Mesh.copy assigns `this.geometry = source.geometry` — the geometry is
      // SHARED with drei's cached GLTF, and so with every other instance of
      // this URL and every future one. Disposing it here destroyed the GPU
      // buffers those instances were still drawing from: delete one shape and
      // the others went blank. The memo above clones each material precisely
      // so this component owns them; it never clones geometry, so it never
      // owns any. See BUG-035.
      //
      // Depends on `wrapper` rather than `[]`: the memo produces a new wrapper
      // whenever `scene` changes (a url swap), and the old empty-dep version
      // closed over the first one forever, leaking every wrapper after it
      // (BUG-038).
      const disposeWrapperMaterials = () => {
        wrapper.traverse((node: any) => {
          if (!(node as THREE.Mesh).isMesh) return;
          const mesh = node as THREE.Mesh;
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m: THREE.Material) => m.dispose());
          } else if (mesh.material) {
            (mesh.material as THREE.Material).dispose();
          }
        });
      };
      const unregister = registerDisposer(shape.id, disposeWrapperMaterials);
      return () => {
        unregister();
        disposeWrapperMaterials();
      };
    }, [wrapper, shape.id]);

    const innerRef = useRef<THREE.Group>(null);
    const mergedRef = (el: THREE.Group | null) => {
      (innerRef as React.MutableRefObject<THREE.Group | null>).current = el;
      if (typeof ref === "function") ref(el);
      else if (ref)
        (ref as React.MutableRefObject<THREE.Group | null>).current = el;
    };

    return (
      <group ref={mergedRef} {...props}>
        <primitive object={wrapper} />
        {isSelected && (
          <mesh scale={[rawSize[0], rawSize[1], rawSize[2]]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial
              color={shape.isLocked ? "#f43f5e" : "#4361ee"}
              wireframe
              transparent
              opacity={0.4}
              depthTest={false}
            />
          </mesh>
        )}
      </group>
    );
  },
);

GlbShapeMesh.displayName = "GlbShapeMesh";

export default GlbShapeMesh;

/**
 * GlbShapeMesh wrapped in its OWN Suspense boundary. `useGLTF` suspends the
 * nearest boundary while a model downloads/decodes; with only the scene-wide
 * boundary in Canvas3D, one slow/large GLB blanked the entire viewport until
 * it resolved. A per-model boundary keeps every already-loaded shape on
 * screen — the slow model is simply absent for the moment (fallback={null})
 * rather than taking the whole scene down with it.
 */
export const SuspendedGlbShapeMesh = React.forwardRef<
  THREE.Group,
  GlbShapeMeshProps
>((props, ref) => (
  <Suspense fallback={null}>
    <GlbShapeMesh {...props} ref={ref} />
  </Suspense>
));

SuspendedGlbShapeMesh.displayName = "SuspendedGlbShapeMesh";
