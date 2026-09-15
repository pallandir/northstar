import {
  PROBE_ATTR,
  PROBE_NAVIGATE_EVENT,
  PROBE_REQUEST_EVENT,
  PROBE_RESPONSE_EVENT,
  PROBE_TIMEOUT_MS,
  type ProbeResult,
} from "./protocol.js";

let counter = 0;

// Ask the main-world probe (installed once per tab by the background worker) about one element.
// The isolated content script cannot read framework internals directly, so the round trip goes
// through a DOM attribute and a pair of window CustomEvents, which cross the world boundary the
// way extension messaging cannot. A timeout means the probe never answered (not installed, the
// page has no matching framework state, or it is simply slow) and callers treat that as "unknown"
// rather than blocking the UI on it.
export function probeElement(el: Element): Promise<ProbeResult | null> {
  const nonce = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  el.setAttribute(PROBE_ATTR, nonce);

  return new Promise<ProbeResult | null>((resolve) => {
    let done = false;
    const finish = (value: ProbeResult | null) => {
      if (done) return;
      done = true;
      window.removeEventListener(PROBE_RESPONSE_EVENT, onResponse);
      clearTimeout(timer);
      el.removeAttribute(PROBE_ATTR);
      resolve(value);
    };
    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nonce?: string; result?: ProbeResult }
        | undefined;
      if (!detail || detail.nonce !== nonce) return;
      finish(detail.result ?? null);
    };
    window.addEventListener(PROBE_RESPONSE_EVENT, onResponse);
    window.dispatchEvent(new CustomEvent(PROBE_REQUEST_EVENT, { detail: { nonce } }));
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
  });
}

export function onNavigate(callback: () => void): () => void {
  window.addEventListener(PROBE_NAVIGATE_EVENT, callback);
  return () => window.removeEventListener(PROBE_NAVIGATE_EVENT, callback);
}
