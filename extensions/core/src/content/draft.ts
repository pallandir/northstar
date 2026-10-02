import { captureElement, captureTarget } from "../lib/fingerprint.js";
import { buildLocate, capturePage, captureSemantics, deriveIntent } from "../lib/locate.js";
import { resolveSource } from "../lib/source-map.js";
import type { ProbeResult } from "../probe/protocol.js";
import type { DraftRequest, Rect } from "../types.js";
import type { InspectorSubmission } from "./inspector.js";

export function buildDraft(
  el: Element,
  payload: InspectorSubmission,
  href: string,
  probe: ProbeResult,
  screenshot: string | null,
): DraftRequest {
  const { operator, elementText } = captureElement(el);
  const r = el.getBoundingClientRect();
  const rect: Rect = { x: r.x, y: r.y, w: r.width, h: r.height };
  const source = resolveSource(el) ?? probe.source;
  const component = probe.component;
  const route = probe.route;
  const target = captureTarget(el, rect);
  const element = captureSemantics(el, target);

  return {
    comment: payload.comment,
    operation: payload.operation,
    operator,
    url: href,
    metadata: {
      page: new URL(href).pathname,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      elementText,
    },
    source,
    component,
    route,
    target,
    screenshotDataUrl: screenshot,
    attachScreenshot: payload.attachScreenshot,
    planFirst: payload.planFirst,
    schemaVersion: 2,
    intent: deriveIntent(payload.operation),
    locate: buildLocate({ source, component, route, target, semantics: element, elementText }),
    page: capturePage(),
    element,
  };
}
