# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this project is

Robotics_CAD (working title "Tinker_CAD" / "cad-module") is a browser-based 3D CAD and robotics-simulation studio. Users place primitive/GLB shapes on a workplane, combine them with CSG (union/subtract/intersect), rig up joints and motion channels, and preview motion driven by an external circuit simulator over a live stream.

There is currently **no backend in this repo** — everything runs client-side. Model metadata is persisted to `localStorage` (see `client/src/features/models/modelService.ts`), and the app talks to an **external** simulation/circuit server over HTTP + SSE/streaming (`client/src/lib/env.ts`, `client/src/lib/circuitStream.ts`). That server is a separate project, expected at `VITE_SIMULATION_SERVER_URL` (default `http://localhost:4010`).

## Repo layout

```
client/               the entire app (Vite + React + TypeScript)
  src/
    pages/
      CadStudio.tsx          main CAD editor (shapes, groups, joints, paths, undo/redo)
      SimulationStudio.tsx   physics/motion playback view
    components/
      Canvas3D.tsx           top-level r3f <Canvas> wrapper
      RightPanel.tsx         right-hand inspector/tool panel shell
      canvas/                everything that renders inside the 3D scene:
                              Scene.tsx, SimulationScene.tsx, CSGGroup.tsx,
                              gizmos (ScaleGizmo/UnifiedScaleGizmo/ViewCube),
                              JointMotionGroup.tsx, KinematicNode.tsx,
                              PathRenderer.tsx, GlbShapeMesh.tsx,
                              PrimitiveGeometry.tsx/PrimitiveCollider.tsx, LODShape.tsx, ...
      right-panel/           tabs/sections for the right panel: InspectorSection,
                              MotionControlSection, CircuitSection, AddObjectsSection,
                              PathsSection, ObjectTab, SettingsTab, ShortcutsSection
      layout/                Breadcrumb, etc.
    lib/
      motionController.ts    interpolates motor/joint targets from streamed signals
      circuitStream.ts       types + helpers for the circuit-simulation SSE payload
      geometryCache.ts       caching for generated/loaded geometry
      shapeDimensions.ts     base-size lookup per primitive/GLB shape
      useCSGWorker.ts        hook wrapping the CSG web worker
      physicsUtils.ts        Rapier-related helpers
      env.ts                 reads VITE_SIMULATION_SERVER_URL, builds CAD_STREAM_URL
    workers/
      csgWorker.ts            off-main-thread boolean (CSG) geometry ops (three-bvh-csg)
    types/workspace.ts        WorkspaceSettings type + localStorage load/save, printer presets
    features/models/          model catalog service (localStorage-backed, "fetch/upload/delete")
  components.json              shadcn/ui config (Tailwind-based UI primitives)
  vite.config.ts, tailwind.config.js, tsconfig.json
  vercel.json                  SPA rewrite config for Vercel deploys
  tests/                        all Vitest unit tests, flat (not under src/) — imports use
                                 the `@/*` -> `src/*` alias (configured in both vite.config.ts
                                 and vitest.config.ts), not relative paths back into src
```

There is no `client/src/store*` — state currently lives in component state/hooks in `CadStudio.tsx` and is threaded down as props (not a global Zustand/Redux store, despite `zustand` being a dependency — check current usage before assuming a store exists).

## Core domain concepts (defined in `pages/CadStudio.tsx`)

- **Shape** — a primitive or GLB mesh placed in the scene.
- **GroupType** — a group of shapes; can be marked `isJoint` with a `jointAxis`/pivot for kinematic chaining, and can carry a `motionChannelId`/`motionType` to bind it to a live motion signal.
- **MotorGroup** — motor-driven group config.
- **MotionPath** — an ordered set of `PathPoint`s ( `[x, y, z]` ) a shape/group can be animated along.
- **TransformMode** — `translate | rotate | scale | drawPath | erase`, drives which gizmo/tool is active.
- **WorkspaceSettings** (`types/workspace.ts`) — grid/shadows/units/zoom/printer-bed presets, persisted to `localStorage` under `cad-ws-settings`.

## Data flow for simulation/circuit

1. `lib/env.ts` builds `CAD_STREAM_URL` from `VITE_SIMULATION_SERVER_URL`.
2. `lib/circuitStream.ts` defines the wire types (`CircuitStreamFrame`, component/pin state, node/link options) matching the external circuit simulator's `SimulationFrame` / `simulation-frame` SSE payload.
3. `lib/motionController.ts`'s `MotionController` consumes `MotionSignalFrame`s (from the stream or manual UI sliders) and interpolates per-target `current -> target` values, which drive joint/motor rotation in the 3D scene (`canvas/JointMotionGroup.tsx`, `canvas/KinematicNode.tsx`).
4. `components/right-panel/CircuitSection.tsx` and `CircuitStreamReadout.tsx` render live telemetry from the stream.

## CSG (boolean ops)

Boolean geometry operations (union/subtract/intersect) use `three-bvh-csg` and run
**synchronously on the main thread**, via `evaluateCustomGeometry` in
`components/canvas/utils/geometryHelpers.ts`. `components/canvas/CSGGroup.tsx` and
`CustomShapeMesh.tsx` are the scene-level consumers. (An earlier `workers/csgWorker.ts`
+ `lib/useCSGWorker.ts` pair was never wired up and was deleted — see BUG-050. What IS
offloaded to a worker is voxel collider generation: `workers/voxelColliderWorker.ts`
via `lib/useVoxelCollider.ts`.)

## Conventions to follow

- **Styling**: Tailwind CSS v4 + shadcn/ui primitives (see `components.json`, `tailwind.config.js`). Prefer existing shadcn components/patterns over new ad-hoc CSS.
- **3D**: React Three Fiber (`@react-three/fiber`) + drei helpers + `@react-three/rapier` for physics. New scene objects belong under `components/canvas/`.
- **Icons**: `lucide-react`.
- **Forms**: `react-hook-form` + `zod` + `@hookform/resolvers`.
- **Routing**: two routes only — `/` (`CadStudio`) and `/simulation` (`SimulationStudio`) via `react-router-dom`.
- **Types**: this is a strict-ish TypeScript codebase; domain types live close to where they're used (`pages/CadStudio.tsx`, `types/workspace.ts`, `lib/circuitStream.ts`) rather than in one global types file.
- Model/workspace persistence is currently `localStorage`-only — don't assume a real backend/database exists unless you find one added later.

## Commands

All commands run from `client/`:

```
npm install
npm run dev       # vite dev server
npm run build     # tsc -b && vite build
npm run lint      # eslint .
npm run preview   # preview production build
```

Tests: `npm test` runs the Vitest unit suite (all specs live in `client/tests/`). A prior
CDP-driven browser harness (`client/e2e/`, driving the real app in Chrome over the
DevTools Protocol) was removed; some findings in `docs/bug-audit-2026-08.md` cite scripts
from it as historical evidence — that verification is no longer automated.

## Known repo issues worth knowing about

An audit of the whole codebase is tracked in **`docs/bug-audit-2026-08.md`** — every
finding has a stable `BUG-nnn` id, a status, and a fix phase. Check there before
re-diagnosing anything in the physics, collider or CSG paths.

- **`README.md` at the repo root has an unresolved git merge conflict** (`<<<<<<<`/`=======`/`>>>>>>>` markers from a `Tinker_CAD` / `cad-module` merge). It hasn't been cleaned up — be aware when reading it, and flag/fix it if you're asked to touch project docs.
- There's a stray root-level `package-lock.json` alongside `client/package-lock.json`; the actual app and its lockfile of record are under `client/`.
- Environment variable for the simulation server is `VITE_SIMULATION_SERVER_URL` (Vite convention, must be prefixed `VITE_` to be exposed to the client).
