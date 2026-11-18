import * as THREE from "three";

// Renders GLB thumbnails into a single, reused offscreen WebGL context instead
// of giving each grid item its own <Canvas>. A grid of admin/simlab models
// each mounting its own react-three-fiber Canvas was creating one WebGL
// context per item; once that plus the main viewport's context crossed the
// browser's live-context limit, the browser silently evicted an existing
// context (often the main scene's), which showed up as the whole canvas
// going blank. Rendering to a shared renderer and snapshotting a PNG avoids
// holding any extra contexts open at all.
const SIZE = 160;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);
  }
  return { renderer, scene: scene!, camera: camera! };
}

export type ThumbnailViewAngle = "front" | "top";

// The shared camera is repositioned per render rather than kept fixed —
// callers ask for a view, not a raw position, and "top" needs an explicit
// lookAt: pointing straight down means the camera's default identity
// rotation (looking down -Z) no longer aims at the origin just by moving
// the camera, unlike "front"'s fly-straight-back case.
function positionCameraForView(cam: THREE.PerspectiveCamera, viewAngle: ThumbnailViewAngle) {
  if (viewAngle === "top") {
    cam.position.set(0, 5, 0);
    // up can't be parallel to the view direction (straight down world Y) —
    // pick a horizontal axis so "up" in the thumbnail is a stable, sensible
    // direction rather than an undefined/degenerate orientation.
    cam.up.set(0, 0, -1);
  } else {
    cam.position.set(0, 0, 5);
    cam.up.set(0, 1, 0);
  }
  cam.lookAt(0, 0, 0);
}

// Thumbnails are keyed by URL and never change for a given asset, so rendering
// one twice is pure waste — and each render uploads that mesh's buffers into
// this second WebGL context, where nothing releases them. Caching bounds the
// cost at one upload per distinct asset instead of one per grid re-render.
const thumbnailCache = new Map<string, string>();

/**
 * Renders `object` to a PNG data URL.
 *
 * `cacheKey` should be the asset's URL when the caller has one; passing it
 * turns repeat calls into a map lookup. Omit it for one-off objects.
 *
 * The object is NOT mutated — see the centring below.
 */
export function renderObjectThumbnail(
  object: THREE.Object3D,
  cacheKey?: string,
  viewAngle: ThumbnailViewAngle = "front",
): string {
  // Two view angles of the same asset are two different images — include
  // the angle in the cache key so a URL rendered both ways (a custom asset
  // reused across categories, say) doesn't hand back the wrong one.
  const effectiveCacheKey = cacheKey ? `${cacheKey}|${viewAngle}` : undefined;
  if (effectiveCacheKey) {
    const hit = thumbnailCache.get(effectiveCacheKey);
    if (hit) return hit;
  }

  const { renderer, scene, camera } = getRenderer();
  positionCameraForView(camera, viewAngle);

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // Centre by translating the WRAPPER, not the caller's object. The previous
  // version did `object.position.sub(center)`, mutating whatever it was
  // handed — harmless for the current caller, which passes a throwaway clone,
  // but a trap the signature never advertised, and cumulative if the same
  // object were ever thumbnailed twice. See BUG-040.
  const wrapper = new THREE.Group();
  wrapper.scale.setScalar(2.5 / maxDim);
  const inner = new THREE.Group();
  inner.position.set(-center.x, -center.y, -center.z);
  inner.add(object);
  wrapper.add(inner);
  scene.add(wrapper);

  renderer.clear();
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");

  // Detach so the caller's object is not left parented into our scratch scene.
  inner.remove(object);
  scene.remove(wrapper);

  if (effectiveCacheKey) thumbnailCache.set(effectiveCacheKey, dataUrl);
  return dataUrl;
}
