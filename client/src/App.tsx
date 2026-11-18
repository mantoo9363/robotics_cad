import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import CadStudio from "./pages/CadStudio";
import { Toaster } from "react-hot-toast";
import ErrorBoundary, { RouteErrorFallback } from "./components/ErrorBoundary";

// /simulation pulls in @react-three/rapier + @dimforge/rapier3d-compat (~2.2 MB
// of WASM bindings) plus the sim-only scene/panels — none of it needed to open
// the CAD editor. Split it into its own chunk, loaded on navigation.
const SimulationStudio = lazy(() => import("./pages/SimulationStudio"));

function RouteFallback({ area }: { area: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#090d16",
        color: "#64748b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      Loading {area}…
    </div>
  );
}

function App({ basename = "/cad-assets/" }: { basename?: string }) {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        {/* Each route gets its own boundary rather than one around <Routes>,
        so a throw in one studio doesn't take the other down with it and
        navigating away lands on a freshly-mounted, un-errored tree. */}
        <Route
          path="/"
          element={
            <ErrorBoundary
              label="CadStudio route"
              fallback={<RouteErrorFallback area="The CAD Editor" homeHref={basename} />}
            >
              <CadStudio />
            </ErrorBoundary>
          }
        />
        <Route
          path="/simulation"
          element={
            <ErrorBoundary
              label="SimulationStudio route"
              fallback={<RouteErrorFallback area="The Simulation Studio" homeHref={basename} />}
            >
              <Suspense fallback={<RouteFallback area="the Simulation Studio" />}>
                <SimulationStudio />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Routes>
      {/* Outside the boundaries on purpose — toasts should still be able to
      report what went wrong after a route has fallen back. */}
      <Toaster position="bottom-right" />
    </BrowserRouter>
  );
}

export default App;

export * from './pages/CadStudio';
