# Tinker_CAD

Vite + React + TypeScript CAD/simulation studio. Vendored into the Teachly app
and compiled in as a component — mounted at `/cad-studio` via
`src/components/cad/CadStudioEmbed.tsx` (see the `@cad/*` tsconfig alias).

`import.meta.env` usages are rewritten to Next equivalents on vendor
(`scripts/cad-codemod` — BASE_URL → `/cad-assets/`, DEV → `process.env.NODE_ENV`,
VITE_SIMULATION_SERVER_URL → `NEXT_PUBLIC_SIMULATION_SERVER_URL`).

## Run standalone (upstream, for reference)

```bash
cd Robotics_CAD/client
npm install
npm run dev        # http://localhost:3004  (Vite base: '/cad/')
```
