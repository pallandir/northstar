import type {
  DeferralNotice,
  PinStatus,
  QueueStatus,
  SendOutcome,
  TerminalStatus,
} from "../messages.js";
import type {
  CommentMetadata,
  DraftRequest,
  Operation,
  QueuedRequest,
  SourceLocation,
} from "../types.js";
import { browser } from "./browser.js";

const QUEUE_KEY = "northstar-queue";
const PORTS = [7474, 7475, 7476];
const PROBE_TIMEOUT_MS = 400;
const SERVER_CACHE_TTL_MS = 30_000;

interface CachedServer {
  info: ServerInfo;
  cachedAt: number;
}

let serverCache: CachedServer | null = null;

export interface ServerComment {
  id: string;
  url: string;
  comment: string;
  operation: Operation;
  operator: string;
  metadata: CommentMetadata;
  status: PinStatus;
  source?: SourceLocation | null;
}

interface Health {
  ok?: boolean;
  service?: string;
  root?: string;
  startedAt?: string;
  version?: number;
  notices?: DeferralNotice[];
  terminal?: TerminalStatus;
}

interface ServerInfo {
  port: number;
  root: string;
  startedAt: string;
  notices: DeferralNotice[];
  version: number | null;
  terminal: TerminalStatus;
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function api(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function request(method: string, port: number, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(api(port, path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function getQueue(): Promise<QueuedRequest[]> {
  const stored = await browser.storage.local.get(QUEUE_KEY);
  return (stored[QUEUE_KEY] as QueuedRequest[] | undefined) ?? [];
}

async function setQueue(queue: QueuedRequest[]): Promise<void> {
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function enqueue(draft: DraftRequest): Promise<QueuedRequest> {
  const queue = await getQueue();
  const item: QueuedRequest = { ...draft, cid: crypto.randomUUID(), queuedAt: Date.now() };
  queue.push(item);
  await setQueue(queue);
  return item;
}

export async function listForUrl(url: string): Promise<QueuedRequest[]> {
  return (await getQueue()).filter((c) => c.url === url);
}

export async function remove(cid: string): Promise<void> {
  await setQueue((await getQueue()).filter((c) => c.cid !== cid));
}

export async function clearAll(): Promise<void> {
  await setQueue([]);
  const server = await findServer();
  if (!server) return;
  try {
    await request("DELETE", server.port, "/comments?all=true");
  } catch {
    serverCache = null;
  }
}

export async function update(
  cid: string,
  text: string,
  opts?: { planFirst?: boolean; screenshotDataUrl?: string | null },
): Promise<void> {
  const queue = await getQueue();
  const item = queue.find((c) => c.cid === cid);
  if (item) {
    item.comment = text;
    if (opts?.planFirst !== undefined) item.planFirst = opts.planFirst;
    if (opts?.screenshotDataUrl !== undefined) item.screenshotDataUrl = opts.screenshotDataUrl;
    await setQueue(queue);
  }
}

async function probe(port: number): Promise<ServerInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(api(port, "/health"), { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Health;
    if (body.service !== "northstar" || !body.root || !body.startedAt) return null;
    return {
      port,
      root: body.root,
      startedAt: body.startedAt,
      notices: body.notices ?? [],
      version: body.version ?? null,
      terminal: body.terminal ?? { available: false },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function findServer(): Promise<ServerInfo | null> {
  if (serverCache && Date.now() - serverCache.cachedAt < SERVER_CACHE_TTL_MS) {
    return serverCache.info;
  }
  serverCache = null;

  const candidates = (await Promise.all(PORTS.map(probe))).filter(
    (r): r is ServerInfo => r !== null,
  );
  if (candidates.length === 0) return null;

  const info = candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  serverCache = { info, cachedAt: Date.now() };
  return info;
}

async function refreshServer(): Promise<ServerInfo | null> {
  const cached = serverCache?.info;
  if (!cached) return findServer();
  const fresh = await probe(cached.port);
  if (!fresh) {
    serverCache = null;
    return findServer();
  }
  serverCache = { info: fresh, cachedAt: Date.now() };
  return fresh;
}

export async function fetchServerComments(url: string): Promise<ServerComment[]> {
  const server = await findServer();
  if (!server) return [];
  try {
    const res = await request("GET", server.port, "/comments");
    if (!res.ok) return [];
    const all = (await res.json()) as ServerComment[];
    return all.filter((c) => c.url === url);
  } catch {
    serverCache = null;
    return [];
  }
}

export async function dismissNotice(commentId: string): Promise<void> {
  const server = await findServer();
  if (!server) return;
  try {
    await request("POST", server.port, "/notices/dismiss", { commentId });
  } catch {
    serverCache = null;
  }
}

function statusFrom(server: ServerInfo | null, queued: number): QueueStatus {
  if (!server) {
    return {
      queued,
      serverReachable: false,
      port: null,
      root: null,
      notices: [],
      version: null,
      terminal: { available: false },
    };
  }
  return {
    queued,
    serverReachable: true,
    port: server.port,
    root: server.root,
    notices: server.notices,
    version: server.version,
    terminal: server.terminal,
  };
}

export interface FlushResult {
  status: QueueStatus;
  send: SendOutcome;
}

export async function flush(): Promise<FlushResult> {
  const server = await findServer();
  const items = await getQueue();
  if (!server) {
    return {
      status: statusFrom(null, items.length),
      send: { sent: 0, typed: false, reason: "the Northstar server is not reachable" },
    };
  }
  if (items.length === 0) {
    return { status: statusFrom(server, 0), send: { sent: 0, typed: false } };
  }

  const batch = items.map(({ cid: _cid, queuedAt: _queuedAt, ...draft }) => draft);
  let send: SendOutcome;
  try {
    const res = await request("POST", server.port, "/comments", batch);
    if (!res.ok) {
      return {
        status: statusFrom(server, items.length),
        send: { sent: 0, typed: false, reason: `the server rejected the batch (${res.status})` },
      };
    }
    const body = (await res.json()) as { ids?: string[]; typed?: boolean; reason?: string };
    send = {
      sent: body.ids?.length ?? items.length,
      typed: body.typed ?? false,
      reason: body.reason,
    };
  } catch (err) {
    serverCache = null;
    return {
      status: statusFrom(null, items.length),
      send: { sent: 0, typed: false, reason: (err as Error).message },
    };
  }

  // Re-read the queue rather than emptying it: anything enqueued while the batch was in flight
  // must survive, so only drop what this flush actually carried.
  const delivered = new Set(items.map((item) => item.cid));
  await setQueue((await getQueue()).filter((item) => !delivered.has(item.cid)));

  const fresh = await refreshServer();
  return { status: statusFrom(fresh, (await getQueue()).length), send };
}

export async function status(): Promise<QueueStatus> {
  const [queue, server] = await Promise.all([getQueue(), refreshServer()]);
  return statusFrom(server, queue.length);
}

export async function reopenComment(id: string, note?: string): Promise<void> {
  const server = await findServer();
  if (!server) return;
  try {
    await request("POST", server.port, "/comments/reopen", { id, note });
  } catch {
    serverCache = null;
  }
}
