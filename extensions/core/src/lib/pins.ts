import type { PinModel, PinStatus, ProblemNote } from "../messages.js";
import type { ComponentInfo, QueuedRequest, RouteInfo, SourceLocation } from "../types.js";
import {
  type ServerComment,
  type ServerStatus,
  fetchServerComments,
  queuedForPage,
} from "./transport.js";

const TARGET_TEXT_MAX = 22;

const STATUS_MAP: Record<ServerStatus, PinStatus> = {
  open: "processing",
  in_progress: "processing",
  resolved: "resolved",
  wontfix: "wontfix",
};

export async function pagePins(
  origin: string,
  page: string,
): Promise<{ pins: PinModel[]; problem: ProblemNote | null }> {
  const [queued, server] = await Promise.all([
    queuedForPage(origin, page),
    fetchServerComments(origin, page),
  ]);
  return {
    pins: [...queued.map(queuedPin), ...server.comments.map(syncedPin)],
    problem: server.problem,
  };
}

function queuedPin(q: QueuedRequest): PinModel {
  return {
    key: q.cid,
    operator: q.operator,
    text: q.comment,
    status: "pending",
    kind: q.operation.type,
    removable: q.sendingAt === undefined,
    route: routeOf(q.route, q.url),
    target: targetLabel(q.component, q.operator, q.source, q.metadata.elementText),
    planFirst: q.planFirst ?? false,
    hasScreenshot: q.attachScreenshot,
    operation: { property: q.operation.property, from: q.operation.from, to: q.operation.to },
    sending: q.sendingAt !== undefined,
    rejection: q.rejection,
  };
}

function syncedPin(s: ServerComment): PinModel {
  return {
    key: s.id,
    operator: s.operator,
    text: s.comment,
    status: STATUS_MAP[s.status],
    kind: s.operation.type,
    removable: false,
    route: routeOf(s.route ?? null, s.url),
    target: targetLabel(s.component ?? null, s.operator, s.source ?? null, s.metadata.elementText),
    planFirst: false,
    hasScreenshot: Boolean(s.screenshot),
    operation: { property: s.operation.property, from: s.operation.from, to: s.operation.to },
  };
}

function routeOf(route: RouteInfo | null, url: string): string {
  return route?.pattern || new URL(url).pathname || "/";
}

function targetLabel(
  component: ComponentInfo | null,
  xpath: string,
  source: SourceLocation | null,
  elementText: string,
): string {
  if (component?.stack?.[0]?.name) return component.stack[0].name;
  if (source?.path) {
    const base = source.path.split(/[\\/]/).pop() ?? source.path;
    const name = base.replace(/\.[^.]+$/, "");
    if (name) return name;
  }
  const tag = lastTag(xpath);
  const text = elementText.trim();
  return text
    ? `${tag} · ${text.length > TARGET_TEXT_MAX ? `${text.slice(0, TARGET_TEXT_MAX)}…` : text}`
    : tag;
}

function lastTag(xpath: string): string {
  const part = xpath.split("/").pop() ?? "";
  const localName = part.match(/local-name\(\)="([^"]+)"/);
  if (localName) return `<${localName[1]}>`;
  const idMatch = part.match(/@id="([^"]+)"/);
  if (idMatch) return `#${idMatch[1]}`;
  const tagMatch = part.match(/^([a-zA-Z][\w-]*)/);
  return tagMatch ? `<${tagMatch[1]}>` : "element";
}
