// @vitest-environment jsdom
//
// Direct confirmation for Phase 1 / BUG-041 + BUG-042
// (docs/bug-audit-2026-08.md): a render-phase throw must no longer take the
// whole app to a blank page.
//
// This file is the only one in the suite that needs a DOM, so it opts in via
// the docblock above rather than switching the shared vitest environment —
// every other test stays on the fast `node` environment.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ErrorBoundary, { RouteErrorFallback } from "@/components/ErrorBoundary";

function Boom({ message = "deliberate test throw" }: { message?: string }): React.ReactNode {
  throw new Error(message);
}

let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React's act() needs this flag set before any render.
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // A caught boundary error is logged by React itself *and* by our
  // componentDidCatch. Both are expected here; silence them so a passing run
  // isn't buried in red.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

describe("control — what the pre-fix code did", () => {
  // Without this control, every assertion below is unfalsifiable: a boundary
  // that never had anything to catch would pass them too. This pins down the
  // behaviour the fix actually changed.
  it("an unguarded throw escapes the render and leaves the page empty", () => {
    expect(() => {
      act(() => {
        root.render(
          <>
            <div>cad editor</div>
            <Boom />
          </>,
        );
      });
    }).toThrow("deliberate test throw");

    // ...and the sibling that rendered fine is gone too — this is the blank
    // page BUG-041 describes. Contrast with the boundary tests below, where
    // the same sibling survives.
    expect(container.textContent).not.toContain("cad editor");
  });
});

describe("ErrorBoundary — BUG-041 route containment", () => {
  it("renders children untouched when nothing throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary fallback={<p>fallback</p>}>
          <span>healthy route</span>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("healthy route");
    expect(container.textContent).not.toContain("fallback");
  });

  it("catches a render-phase throw and renders the fallback instead of nothing", () => {
    act(() => {
      root.render(
        <ErrorBoundary fallback={<p>route fallback</p>}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // The actual regression guard: before the fix this subtree unmounted and
    // left an empty container behind.
    expect(container.innerHTML).not.toBe("");
    expect(container.textContent).toContain("route fallback");
  });

  it("contains the blast radius — a sibling route stays mounted", () => {
    act(() => {
      root.render(
        <>
          <ErrorBoundary fallback={<p>simulation is down</p>}>
            <Boom />
          </ErrorBoundary>
          <div>cad editor still here</div>
        </>,
      );
    });
    expect(container.textContent).toContain("simulation is down");
    expect(container.textContent).toContain("cad editor still here");
  });

  it("RouteErrorFallback names the area and offers a way out", () => {
    act(() => {
      root.render(<RouteErrorFallback area="The Simulation Studio" />);
    });
    expect(container.textContent).toContain("The Simulation Studio hit an error");
    const buttons = Array.from(container.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(buttons).toContain("Reload");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("logs the failure with its label rather than swallowing it", () => {
    act(() => {
      root.render(
        <ErrorBoundary label="SimulationStudio route" fallback={<p>fb</p>}>
          <Boom message="kaboom" />
        </ErrorBoundary>,
      );
    });
    const ourLog = (consoleError.mock.calls as unknown[][]).find(
      (args) => typeof args[0] === "string" && args[0].includes("[ErrorBoundary]"),
    );
    expect(ourLog).toBeDefined();
    expect(String(ourLog![0])).toContain("SimulationStudio route");
    expect((ourLog![1] as Error).message).toBe("kaboom");
  });
});

describe("ErrorBoundary — BUG-042 in-Canvas asset failures", () => {
  it("reports through onError so a DOM-side parent can show a notice", () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <ErrorBoundary label="CAD scene" fallback={null} onError={onError}>
          <Boom message="Could not load /uploads/missing.glb" />
        </ErrorBoundary>,
      );
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toContain("missing.glb");
  });

  it("renders nothing (not a DOM node) when fallback is null", () => {
    // The in-Canvas boundaries must not emit DOM: a <div> inside <Canvas>
    // crashes the react-three-fiber reconciler this boundary exists to protect.
    act(() => {
      root.render(
        <ErrorBoundary fallback={null}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    expect(container.innerHTML).toBe("");
  });

  it("keeps the surrounding scene mounted when one asset subtree fails", () => {
    act(() => {
      root.render(
        <>
          <div>canvas chrome</div>
          <ErrorBoundary fallback={null}>
            <Boom />
          </ErrorBoundary>
        </>,
      );
    });
    expect(container.textContent).toContain("canvas chrome");
  });
});
