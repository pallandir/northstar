import {
  PROBE_ANSWER_TIMEOUT_MS,
  PROBE_ATTR,
  PROBE_NAVIGATE_EVENT,
  PROBE_REQUEST_EVENT,
  PROBE_RESPONSE_EVENT,
  type ProbeResult,
} from "./protocol.js";

export type ProbeOutcome = { ok: true; result: ProbeResult } | { ok: false; error: Error };

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProbeResult(value: unknown): value is ProbeResult {
  return (
    isRecord(value) &&
    "component" in value &&
    "source" in value &&
    "route" in value &&
    Array.isArray(value.failures)
  );
}

export function probeElement(
  el: Element,
  timeoutMs = PROBE_ANSWER_TIMEOUT_MS,
): Promise<ProbeResult> {
  const nonce = newNonce();
  el.setAttribute(PROBE_ATTR, nonce);

  return new Promise<ProbeResult>((resolve, reject) => {
    function cleanup(): void {
      window.removeEventListener(PROBE_RESPONSE_EVENT, onResponse);
      clearTimeout(timer);
      el.removeAttribute(PROBE_ATTR);
    }

    function onResponse(event: Event): void {
      const detail: unknown = (event as CustomEvent).detail;
      if (!isRecord(detail) || detail.nonce !== nonce) return;
      cleanup();
      if (typeof detail.error === "string") {
        reject(new Error(`page probe failed: ${detail.error}`));
      } else if (!isProbeResult(detail.result)) {
        reject(new Error("page probe sent an invalid answer"));
      } else {
        resolve(detail.result);
      }
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("page probe did not answer"));
    }, timeoutMs);
    window.addEventListener(PROBE_RESPONSE_EVENT, onResponse);
    window.dispatchEvent(new CustomEvent(PROBE_REQUEST_EVENT, { detail: nonce }));
  });
}

export function settleProbe(promise: Promise<ProbeResult>): Promise<ProbeOutcome> {
  return promise.then(
    (result): ProbeOutcome => ({ ok: true, result }),
    (error: unknown): ProbeOutcome => ({
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }),
  );
}

export function onNavigate(callback: () => void): () => void {
  window.addEventListener(PROBE_NAVIGATE_EVENT, callback);
  return () => window.removeEventListener(PROBE_NAVIGATE_EVENT, callback);
}
