import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Broker } from "./broker.js";
import type { CommentStore } from "./store.js";
import type { Handoff } from "./terminal/index.js";
import { parseBatchItems } from "./validate.js";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const SERVICE = "northstar";
const CHROME_EXTENSION_IDS = ["mmpgoabhnlkcgboiiaebeahcbbeeaggb"];

function chromeExtensionIds(): Set<string> {
  const extra = (process.env.NORTHSTAR_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .replace(/^chrome-extension:\/\//, "")
        .replace(/\/$/, ""),
    )
    .filter(Boolean);
  return new Set([...CHROME_EXTENSION_IDS, ...extra]);
}

export interface IngestServer {
  port: number;
  broker: Broker;
  close: () => Promise<void>;
}

export async function startIngestServer(
  store: CommentStore,
  preferredPorts: number[],
  log: (msg: string) => void,
  broker: Broker,
  handoff: Handoff,
): Promise<IngestServer> {
  const server = createServer((req, res) => {
    const port = (server.address() as { port: number } | null)?.port ?? 0;
    handle(req, res, store, log, port, broker, handoff).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  });
  const port = await listenFirstAvailable(server, preferredPorts);
  return {
    port,
    broker,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function originAllowed(origin: string | undefined, healthProbe = false): boolean {
  if (origin === undefined) return healthProbe;
  if (origin.startsWith("moz-extension://")) return true;
  if (origin.startsWith("chrome-extension://")) {
    return chromeExtensionIds().has(origin.slice("chrome-extension://".length));
  }
  return false;
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const [name, hostPort] = host.split(":");
  if (hostPort && Number(hostPort) !== port) return false;
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function setCors(res: ServerResponse, origin: string | undefined): void {
  res.setHeader("Vary", "Origin");
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: CommentStore,
  log: (msg: string) => void,
  port: number,
  broker: Broker,
  handoff: Handoff,
): Promise<void> {
  const origin = req.headers.origin;
  setCors(res, origin);

  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const healthProbe = req.method === "GET" && pathname === "/health";

  if (!originAllowed(origin, healthProbe) || !hostAllowed(req.headers.host, port)) {
    json(res, 403, { error: "forbidden" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: SERVICE,
      root: store.root,
      startedAt: broker.startedAt,
      pid: broker.pid,
      version: broker.currentVersion,
      lastPolledAt: broker.lastPolledAt,
      notices: broker.pendingNotices,
      terminal: await handoff.describe(),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/state") {
    json(res, 200, await snapshot(store, broker, handoff));
    return;
  }

  if (req.method === "POST" && pathname === "/notices/dismiss") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { commentId?: string };
      if (!parsed.commentId || typeof parsed.commentId !== "string") {
        json(res, 400, { error: "commentId required" });
        return;
      }
      broker.dismissNotice(parsed.commentId);
      json(res, 200, { ok: true });
    } catch (err) {
      log((err as Error).message);
      json(res, 400, { error: "bad request" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/comments") {
    json(res, 200, await store.list());
    return;
  }

  if (req.method === "DELETE" && pathname === "/comments") {
    const url = query(req.url, "url");
    const all = query(req.url, "all");
    if (!url && all !== "true") {
      json(res, 400, { error: "url or ?all=true required" });
      return;
    }
    const removed = await store.clear(url ?? undefined);
    broker.bump();
    log(`cleared ${removed} comment(s)${url ? ` on ${url}` : ""}`);
    json(res, 200, { removed });
    return;
  }

  if (req.method === "POST" && pathname === "/comments") {
    let results: ReturnType<typeof parseBatchItems>;
    try {
      results = parseBatchItems(await readBody(req));
    } catch (err) {
      log((err as Error).message);
      json(res, 400, { error: "bad request" });
      return;
    }

    const accepted: { cid: string | null; index: number; id: string }[] = [];
    const rejected: { cid: string | null; index: number; reason: string }[] = [];
    let fresh = 0;
    for (const { index, cid, value, reason } of results) {
      if (!value) {
        rejected.push({ cid, index, reason: reason ?? "invalid" });
        continue;
      }
      try {
        const { comment, duplicate } = await store.ingest(value, store.root);
        accepted.push({ cid, index, id: comment.id });
        if (!duplicate) fresh += 1;
      } catch (err) {
        log((err as Error).message);
        rejected.push({ cid, index, reason: "storage failure" });
      }
    }

    if (accepted.length === 0) {
      log(`rejected ${rejected.length} comment(s)`);
      json(res, 400, { error: "bad request", accepted, rejected, ids: [], typed: false });
      return;
    }

    const ids = accepted.map((a) => a.id);
    if (fresh > 0) broker.bump();
    log(`ingested ${fresh} new comment(s): ${ids.join(", ")}`);
    const result = fresh > 0 ? await handoff.send() : { typed: false, reason: "already received" };
    json(res, 201, { ids, accepted, rejected, ...result });
    return;
  }

  if (req.method === "POST" && pathname === "/comments/reopen") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { id?: string; note?: string };
      if (!parsed.id || typeof parsed.id !== "string") {
        json(res, 400, { error: "id required" });
        return;
      }
      const comment = await store.reopenWithNote(parsed.id, parsed.note);
      if (!comment) {
        json(res, 404, { error: "not found" });
        return;
      }
      broker.bump();
      json(res, 200, { ok: true });
    } catch (err) {
      log((err as Error).message);
      json(res, 400, { error: "bad request" });
    }
    return;
  }

  json(res, 404, { error: "not found" });
}

async function snapshot(store: CommentStore, broker: Broker, handoff: Handoff) {
  return {
    version: broker.currentVersion,
    lastPolledAt: broker.lastPolledAt,
    comments: await store.list(),
    notices: broker.pendingNotices,
    terminal: await handoff.describe(),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function query(url: string | undefined, key: string): string | null {
  return new URL(url ?? "", "http://localhost").searchParams.get(key);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function listenFirstAvailable(
  server: ReturnType<typeof createServer>,
  ports: number[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (index: number) => {
      if (index >= ports.length) {
        reject(new Error(`no available port in ${ports.join(", ")}`));
        return;
      }
      const port = ports[index];
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          tryPort(index + 1);
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve((server.address() as { port: number } | null)?.port ?? port);
      });
    };
    tryPort(0);
  });
}
