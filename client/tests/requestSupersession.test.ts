import { describe, it, expect } from "vitest";
import { RequestTracker } from "@/lib/requestSupersession";

describe("RequestTracker", () => {
  it("BUG-050 scenario: a late reply for a superseded key is rejected, the new key's reply is accepted", () => {
    const tracker = new RequestTracker<string, number>();

    // compute("A") — dispatch request id 1.
    const beginA = tracker.beginRequest("A");
    expect(beginA.shouldDispatch).toBe(true);
    expect(beginA.supersededId).toBeNull();
    tracker.setPending("A", 1);

    // Before A resolves, the shape is edited: compute("B") — dispatch id 2.
    // A's id (1) must come back as superseded so the caller drops it from
    // its in-flight map.
    const beginB = tracker.beginRequest("B");
    expect(beginB.shouldDispatch).toBe(true);
    expect(beginB.supersededId).toBe(1);
    tracker.setPending("B", 2);

    // A's reply arrives late. This is exactly the BUG-050 case: the old
    // hook had no check here and would have written A's result under
    // whatever key was current (B) — cache poisoning. It must be rejected.
    expect(tracker.isReplyCurrent(1)).toBe(false);

    // B's reply arrives. It must be accepted.
    expect(tracker.isReplyCurrent(2)).toBe(true);
  });

  it("compute() with the already-current key is a no-op", () => {
    const tracker = new RequestTracker<string, number>();
    tracker.beginRequest("A");
    tracker.setPending("A", 1);

    const again = tracker.beginRequest("A");
    expect(again.shouldDispatch).toBe(false);
    expect(again.supersededId).toBeNull();
    // The original pending id must be untouched by the no-op call.
    expect(tracker.isReplyCurrent(1)).toBe(true);
  });

  it("a reply is only ever applied once (clearPending prevents double-apply)", () => {
    const tracker = new RequestTracker<string, number>();
    tracker.beginRequest("A");
    tracker.setPending("A", 1);

    expect(tracker.isReplyCurrent(1)).toBe(true);
    tracker.clearPending(1);
    expect(tracker.isReplyCurrent(1)).toBe(false);
  });

  it("BUG-012 scenario: a failed key can be retried, not stuck forever", () => {
    const tracker = new RequestTracker<string, number>();
    tracker.beginRequest("A");
    tracker.setPending("A", 1);

    // Request fails — caller resolves as a failure and resets the key.
    tracker.clearPending(1);
    tracker.resetKey();

    // A later compute("A") — e.g. the user retries — must dispatch again,
    // not silently no-op because "A" was already (permanently) current.
    const retry = tracker.beginRequest("A");
    expect(retry.shouldDispatch).toBe(true);
  });

  it("setPending() is a no-op if the key was superseded before it could be recorded", () => {
    const tracker = new RequestTracker<string, number>();
    tracker.beginRequest("A");
    // Simulate a synchronous second compute() call landing before A's
    // setPending() — B supersedes A first.
    tracker.beginRequest("B");
    // A's setPending() call, arriving "late" relative to the key change,
    // must not resurrect A as pending.
    tracker.setPending("A", 1);
    expect(tracker.isReplyCurrent(1)).toBe(false);
  });

  it("three-in-a-row supersession chains correctly (A -> B -> C, only C's reply is current)", () => {
    const tracker = new RequestTracker<string, number>();
    tracker.beginRequest("A");
    tracker.setPending("A", 1);
    const beginB = tracker.beginRequest("B");
    expect(beginB.supersededId).toBe(1);
    tracker.setPending("B", 2);
    const beginC = tracker.beginRequest("C");
    expect(beginC.supersededId).toBe(2);
    tracker.setPending("C", 3);

    expect(tracker.isReplyCurrent(1)).toBe(false);
    expect(tracker.isReplyCurrent(2)).toBe(false);
    expect(tracker.isReplyCurrent(3)).toBe(true);
  });

  it("reset() clears both key and pending id (component unmount)", () => {
    const tracker = new RequestTracker<string, number>();
    tracker.beginRequest("A");
    tracker.setPending("A", 1);
    tracker.reset();
    expect(tracker.isReplyCurrent(1)).toBe(false);
    const again = tracker.beginRequest("A");
    expect(again.shouldDispatch).toBe(true);
  });

  it("droppedCount increments once per superseded request, not per beginRequest call", () => {
    const tracker = new RequestTracker<string, number>();
    expect(tracker.droppedCount).toBe(0);

    tracker.beginRequest("A"); // no supersession — nothing pending yet
    expect(tracker.droppedCount).toBe(0);
    tracker.setPending("A", 1);

    tracker.beginRequest("B"); // supersedes A's pending id=1
    expect(tracker.droppedCount).toBe(1);
    tracker.setPending("B", 2);

    tracker.beginRequest("B"); // already current — no-op, no drop
    expect(tracker.droppedCount).toBe(1);

    tracker.beginRequest("C"); // supersedes B's pending id=2
    expect(tracker.droppedCount).toBe(2);
  });
});
