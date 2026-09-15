import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installProbe } from "./probe-script.js";
import {
  PROBE_ATTR,
  PROBE_REQUEST_EVENT,
  PROBE_RESPONSE_EVENT,
  type ProbeResult,
} from "./protocol.js";

// installProbe is written to be injected standalone into a page's main world, so it only ever
// touches `window`/`document` globals: that also means it can run unmodified against happy-dom
// fixtures here, exercising the actual reader logic rather than just checking it parses.

function mount<T extends Element>(el: T): T {
  document.body.appendChild(el);
  return el;
}

function ask(el: Element): Promise<ProbeResult | null> {
  const nonce = "test-nonce";
  el.setAttribute(PROBE_ATTR, nonce);
  return new Promise((resolve) => {
    window.addEventListener(
      PROBE_RESPONSE_EVENT,
      (event) => {
        const detail = (event as CustomEvent).detail as { nonce: string; result: ProbeResult };
        resolve(detail.nonce === nonce ? detail.result : null);
      },
      { once: true },
    );
    window.dispatchEvent(new CustomEvent(PROBE_REQUEST_EVENT, { detail: { nonce } }));
  });
}

describe("installProbe", () => {
  beforeEach(() => {
    (window as unknown as { __northstarProbeInstalled?: boolean }).__northstarProbeInstalled =
      undefined;
    installProbe();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is idempotent: a second install does not double-register listeners", () => {
    const before = (window as unknown as { __northstarProbeInstalled?: boolean })
      .__northstarProbeInstalled;
    installProbe();
    expect(before).toBe(true);
  });

  it("returns nulls for a plain element with no framework state", async () => {
    const el = mount(document.createElement("div"));
    const result = await ask(el);
    expect(result?.component).toBeNull();
    expect(result?.source).toBeNull();
  });

  it("reads a React fiber's component stack and _debugSource", () => {
    const child = mount(document.createElement("div"));
    const parentFiber = {
      type: function DashboardPage() {},
      return: null,
    };
    const fiber = {
      type: function TrafficSources() {},
      _debugSource: {
        fileName: "src/components/TrafficSources.tsx",
        lineNumber: 42,
        columnNumber: 8,
      },
      return: parentFiber,
    };
    (child as unknown as Record<string, unknown>).__reactFiber$abc123 = fiber;

    return ask(child).then((result) => {
      expect(result?.component?.stack.map((f) => f.name)).toEqual([
        "TrafficSources",
        "DashboardPage",
      ]);
      expect(result?.source).toEqual({
        path: "src/components/TrafficSources.tsx",
        line: 42,
        column: 8,
        via: "react-fiber",
      });
    });
  });

  it("reads a Vue 3 component instance's __file", async () => {
    const el = mount(document.createElement("div"));
    (el as unknown as Record<string, unknown>).__vueParentComponent = {
      type: { __name: "TrafficSources", __file: "src/components/TrafficSources.vue" },
      parent: null,
    };
    const result = await ask(el);
    expect(result?.component?.stack[0].name).toBe("TrafficSources");
    expect(result?.source?.path).toBe("src/components/TrafficSources.vue");
    expect(result?.source?.via).toBe("vue-component-file");
  });

  it("reads a Vue 2 instance's $options", async () => {
    const el = mount(document.createElement("div"));
    (el as unknown as Record<string, unknown>).__vue__ = {
      $options: { name: "TrafficSources", __file: "src/components/TrafficSources.vue" },
      $parent: null,
    };
    const result = await ask(el);
    expect(result?.component?.stack[0].name).toBe("TrafficSources");
  });

  it("reads Svelte's __svelte_meta location", async () => {
    const el = mount(document.createElement("div"));
    (el as unknown as Record<string, unknown>).__svelte_meta = {
      loc: { file: "src/components/TrafficSources.svelte", line: 3, column: 1 },
    };
    const result = await ask(el);
    expect(result?.source?.path).toBe("src/components/TrafficSources.svelte");
    expect(result?.component?.stack[0].name).toBe("TrafficSources.svelte");
  });

  it("resolves an exact Next.js route from __NEXT_DATA__", async () => {
    (window as unknown as Record<string, unknown>).__NEXT_DATA__ = {
      page: "/users/[id]",
      query: { id: "8123" },
    };
    const el = mount(document.createElement("div"));
    const result = await ask(el);
    expect(result?.route).toEqual({
      pattern: "/users/[id]",
      params: { id: "8123" },
      router: "next",
      routeFile: null,
      confidence: "exact",
    });
    (window as unknown as Record<string, unknown>).__NEXT_DATA__ = undefined;
  });

  it("falls back to an inferred pattern and says so", async () => {
    const originalPathname = window.location.pathname;
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/users/8123" },
      writable: true,
    });
    const el = mount(document.createElement("div"));
    const result = await ask(el);
    expect(result?.route?.confidence).toBe("inferred");
    expect(result?.route?.pattern).toBe("/users/:id");
    Object.defineProperty(window, "location", { value: window.location, writable: true });
    void originalPathname;
  });

  it("emits northstar:navigate on history.pushState", async () => {
    const seen = new Promise<void>((resolve) => {
      window.addEventListener("northstar:navigate", () => resolve(), { once: true });
    });
    history.pushState({}, "", "/next");
    await seen;
  });
});
