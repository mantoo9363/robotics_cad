import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // App is reverse-proxied under yourapp.com/cad (previously standalone at
  // cad.theteachly.com). `base` prefixes every built asset URL and sets
  // import.meta.env.BASE_URL — Vite's equivalent of Next basePath + assetPrefix.
  base: '/cad/',
  // Pinned so the main app's reverse proxy can reach this app at a fixed
  // origin (CAD_APP_ORIGIN=http://localhost:3004 in the main app's env).
  server: { port: 3004 },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
