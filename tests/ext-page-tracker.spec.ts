import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageTracker } from "../extensions/core/src/content/page-tracker.js";
import { PROBE_NAVIGATE_EVENT } from "../extensions/core/src/probe/protocol.js";

afterEach(() => {
  history.replaceState({}, "", "/");
});

describe("createPageTracker", () => {
  it("reports a new page key when the route changes", () => {
    const onChange = vi.fn();
    const tracker = createPageTracker(onChange);
    history.pushState({}, "", "/users/8123");
    window.dispatchEvent(new CustomEvent(PROBE_NAVIGATE_EVENT));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toMatch(/\/users\/8123$/);
    tracker.stop();
  });

  it("stays quiet when only the query, hash or trailing slash changes", () => {
    const onChange = vi.fn();
    const tracker = createPageTracker(onChange);
    history.replaceState({}, "", "/?tab=2#top");
    window.dispatchEvent(new CustomEvent(PROBE_NAVIGATE_EVENT));
    expect(onChange).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("notices a change on a poll even when no navigate event fired", () => {
    const onChange = vi.fn();
    const tracker = createPageTracker(onChange);
    history.pushState({}, "", "/settings");
    expect(tracker.check()).toBe(true);
    expect(tracker.check()).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
    tracker.stop();
  });

  it("stops listening after stop", () => {
    const onChange = vi.fn();
    const tracker = createPageTracker(onChange);
    tracker.stop();
    history.pushState({}, "", "/other");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
