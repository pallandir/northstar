import { afterEach, describe, expect, it, vi } from "vitest";
import { probeElement } from "../extensions/core/src/probe/client.js";
import {
  PROBE_ATTR,
  PROBE_REQUEST_EVENT,
  PROBE_RESPONSE_EVENT,
  type ProbeResult,
} from "../extensions/core/src/probe/protocol.js";

const result: ProbeResult = { component: null, source: null, route: null, failures: [] };

function answer(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(PROBE_RESPONSE_EVENT, { detail }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("probeElement", () => {
  it("resolves when the page probe answers synchronously inside the request", async () => {
    const el = document.createElement("div");
    const onRequest = (event: Event) => {
      answer({ nonce: (event as CustomEvent).detail, result });
    };
    window.addEventListener(PROBE_REQUEST_EVENT, onRequest);
    await expect(probeElement(el)).resolves.toEqual(result);
    window.removeEventListener(PROBE_REQUEST_EVENT, onRequest);
    expect(el.hasAttribute(PROBE_ATTR)).toBe(false);
  });

  it("rejects with a clear error when the probe never answers", async () => {
    const el = document.createElement("div");
    await expect(probeElement(el, 10)).rejects.toThrow("page probe did not answer");
    expect(el.hasAttribute(PROBE_ATTR)).toBe(false);
  });

  it("rejects when the probe reports an error", async () => {
    const el = document.createElement("div");
    const onRequest = (event: Event) => {
      answer({ nonce: (event as CustomEvent).detail, error: "boom" });
    };
    window.addEventListener(PROBE_REQUEST_EVENT, onRequest);
    await expect(probeElement(el)).rejects.toThrow("page probe failed: boom");
    window.removeEventListener(PROBE_REQUEST_EVENT, onRequest);
  });

  it("ignores answers carrying another nonce", async () => {
    const el = document.createElement("div");
    const onRequest = () => answer({ nonce: "forged", result });
    window.addEventListener(PROBE_REQUEST_EVENT, onRequest);
    await expect(probeElement(el, 10)).rejects.toThrow("page probe did not answer");
    window.removeEventListener(PROBE_REQUEST_EVENT, onRequest);
  });

  it("rejects an answer with the wrong shape", async () => {
    const el = document.createElement("div");
    const onRequest = (event: Event) => {
      answer({ nonce: (event as CustomEvent).detail, result: { component: null } });
    };
    window.addEventListener(PROBE_REQUEST_EVENT, onRequest);
    await expect(probeElement(el)).rejects.toThrow("page probe sent an invalid answer");
    window.removeEventListener(PROBE_REQUEST_EVENT, onRequest);
  });
});
