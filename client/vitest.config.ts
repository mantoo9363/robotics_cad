import path from "path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: the unit tests here exercise
// pure geometry/data functions (no DOM, no React), so this stays minimal
// (no react/tailwind plugins) rather than sharing the app's dev config.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
