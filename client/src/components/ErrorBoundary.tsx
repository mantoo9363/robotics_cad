import React, { Component } from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  // Rendered in place of `children` once an error is caught. Must be valid
  // for the tree this boundary sits in: a boundary in the DOM tree can
  // render DOM, but a boundary *inside* <Canvas> can only render three.js
  // elements or nothing at all — a <div> there would crash the renderer it
  // is meant to protect. Defaults to rendering nothing, which is the safe
  // choice inside a Canvas.
  fallback?: React.ReactNode;
  // Identifies which boundary tripped, in the console. Worth setting when
  // several boundaries are nested.
  label?: string;
  // Called once per caught error. Exists so a boundary whose own fallback
  // cannot render DOM (see `fallback`) can still let a DOM-side parent
  // surface a notice to the user.
  onError?: (error: Error) => void;
};

type ErrorBoundaryState = { hasError: boolean; error: Error | null };

/**
 * Shared error boundary. Previously this lived as a private class inside
 * AddObjectsSection.tsx and only guarded thumbnail previews, which left every
 * route and both 3D canvases unprotected — any render-phase throw took the
 * whole app to a blank page (see docs/bug-audit-2026-08.md, BUG-041/BUG-042).
 *
 * Note this catches *render-phase* errors only. Errors thrown in event
 * handlers, in `setTimeout`, or in promise rejections are not render-phase
 * and still need their own try/catch at the throw site.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const where = this.props.label ? ` (${this.props.label})` : "";
    console.error(
      `[ErrorBoundary]${where} caught a render error:`,
      error,
      errorInfo.componentStack,
    );
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

/**
 * Full-page fallback for a route-level boundary. Deliberately plain DOM and
 * inline styles — it has to render correctly even when whatever broke was a
 * styling, canvas, or state-shape problem, so it depends on nothing the app
 * sets up.
 */
export function RouteErrorFallback({
  area,
  homeHref = "/cad-assets/",
}: {
  area: string;
  homeHref?: string;
}) {
  return (
    <div
      role="alert"
      style={{
        width: "100%",
        height: "100%",
        background: "#090d16",
        color: "#cbd5e1",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
        {area} hit an error
      </h1>
      <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, maxWidth: 460 }}>
        The rest of the app is still running. Details are in the browser
        console. If this keeps happening, your saved workspace may be corrupt —
        reloading starts from the last good state.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#1e293b",
            color: "#e2e8f0",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
        <button
          onClick={() => {
            window.location.href = homeHref;
          }}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "transparent",
            color: "#94a3b8",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Back to CAD Editor
        </button>
      </div>
    </div>
  );
}
