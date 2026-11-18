import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";

type Props = {
  /** Stable array of GLB urls referenced by CSG members (see Canvas3D). */
  urls: string[];
  /** Called whenever the merged-geometry map changes identity. */
  onMap: (map: Map<string, THREE.BufferGeometry>) => void;
};

/**
 * Pre-loads and normalises the GLB geometries that CSG members subtract/union
 * against, exposing them to the scene as a `url -> BufferGeometry` map.
 *
 * This lives in its OWN component wrapped in its OWN <Suspense> boundary
 * (see Canvas3D) on purpose. `useGLTF` suspends while a model downloads; when
 * this logic sat inline in Canvas3D's body it had NO Suspense boundary above
 * it, so adding the first GLB shape suspended the whole CadStudio route and
 * blew away the <Canvas> (WebGL context loss + full remount) until the model
 * resolved — the "whole canvas reloads when I load a new shape" report.
 * Isolated here, only this null-rendering helper suspends; the scene keeps
 * drawing with the previous map and picks up the new geometry a frame later.
 */
export default function CsgGeometryLoader({ urls, onMap }: Props) {
  const gltfs = useGLTF(urls);

  const map = useMemo(() => {
    const out = new Map<string, THREE.BufferGeometry>();
    if (urls.length === 0) return out;

    const results = Array.isArray(gltfs) ? gltfs : [gltfs];

    urls.forEach((url, i) => {
      const gltf = results[i];
      if (!gltf) return;

      const geoms: THREE.BufferGeometry[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((node: THREE.Object3D) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          const cloned = mesh.geometry.clone();
          cloned.applyMatrix4(mesh.matrixWorld);
          geoms.push(cloned);
        }
      });
      if (geoms.length === 0) return;

      try {
        const merged = mergeGeometries(geoms, false);
        if (!merged) return;
        merged.computeBoundingBox();
        const box = merged.boundingBox;
        if (box) {
          const size = new THREE.Vector3();
          box.getSize(size);
          const center = new THREE.Vector3();
          box.getCenter(center);
          const maxDim = Math.max(size.x, size.y, size.z);
          const scaleFactor = maxDim > 0 ? 1.0 / maxDim : 1.0;
          merged.translate(-center.x, -center.y, -center.z);
          merged.scale(scaleFactor, scaleFactor, scaleFactor);
        }
        out.set(url, merged);
      } catch (e) {
        console.error(
          `[CsgGeometryLoader] failed to merge GLB geometry for "${url}" — this ` +
            `model will render without a collider or mesh:`,
          e,
        );
      }
    });
    return out;
  }, [urls, gltfs]);

  useEffect(() => {
    onMap(map);
  }, [map, onMap]);

  return null;
}
