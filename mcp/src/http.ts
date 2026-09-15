import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Broker } from "./broker.js";
import type { CommentStore } from "./store.js";
import type { Handoff } from "./terminal/index.js";
import { parseBatch } from "./validate.js";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const SERVICE = "northstar";

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

export function originAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
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

  if (!originAllowed(origin) || !hostAllowed(req.headers.host, port)) {
    json(res, 403, { error: "forbidden" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

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
    let ids: string[];
    try {
      const incoming = parseBatch(await readBody(req));
      ids = [];
      for (const item of incoming) {
        const comment = await store.add(item, store.root);
        ids.push(comment.id);
      }
    } catch (err) {
      log((err as Error).message);
      json(res, 400, { error: "bad request" });
      return;
    }
    broker.bump();
    log(`ingested ${ids.length} comment(s): ${ids.join(", ")}`);
    const result = await handoff.send();
    json(res, 201, { ids, ...result });
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
