import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { basename, join, sep } from "node:path";
import {
  type ApiError,
  type ApiErrorStatus,
  DRAFT_FIX,
  type DraftCheck,
  LIMITS,
  type OwnsResponse,
  PAIR_PATH,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type PostCommentsResponse,
  type Rejection,
  SERVICE_NAME,
  SourcePathError,
  TOKEN_HEADER,
  apiError,
  checkDrafts,
  pageKey,
  sanitizeSourcePath,
} from "@northstar/protocol";
import type { Broker } from "./broker.js";
import { VERSION } from "./config.js";
import type { Delivery } from "./delivery.js";
import { pairCsp, pairPage } from "./lib/pair-page.js";
import { loadOrCreateToken, northstarHome, tokenMatches } from "./lib/token.js";
import type { CommentStore } from "./store.js";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_NONCES = 20;
const MAX_OWNS_PATHS = 20;
const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\/[^/]+$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface IngestServer {
  port: number;
  broker: Broker;
  close: () => Promise<void>;
}

export interface IngestOptions {
  home?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: ApiErrorStatus,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

interface Context {
  store: CommentStore;
  broker: Broker;
  delivery: Delivery;
  sending: boolean;
  log: (msg: string) => void;
  port: number;
  token: string;
  nonces: Map<string, number>;
}

export async function startIngestServer(
  store: CommentStore,
  preferredPorts: number[],
  log: (msg: string) => void,
  broker: Broker,
  delivery: Delivery,
  options: IngestOptions = {},
): Promise<IngestServer> {
  const token = loadOrCreateToken(options.home ?? northstarHome());
  const context: Context = {
    store,
    broker,
    delivery,
    sending: false,
    log,
    port: 0,
    token,
    nonces: new Map(),
  };
  const server = createServer((req, res) => {
    handle(req, res, context).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(res, error);
        return;
      }
      log(`internal error on ${req.method} ${req.url}: ${(error as Error).stack ?? String(error)}`);
      sendError(
        res,
        new HttpError(
          500,
          apiError(
            "Northstar hit an internal error.",
            "Check the agent terminal for details, then try again.",
          ),
        ),
      );
    });
  });
  const port = await listenFirstAvailable(server, preferredPorts);
  context.port = port;
  return {
    port,
    broker,
    close: () =>
      new Promise((resolve) => {
        const forced = setTimeout(() => server.closeAllConnections(), 2000);
        forced.unref();
        server.close(() => {
          clearTimeout(forced);
          resolve();
        });
        server.closeIdleConnections();
      }),
  };
}

function forbidden(fix: string): HttpError {
  return new HttpError(403, apiError("This request is not allowed.", fix));
}

function notFound(): HttpError {
  return new HttpError(
    404,
    apiError(
      "Northstar does not know this route.",
      "Update the extension and the Northstar server.",
    ),
  );
}

function badRequest(error: string, fix: string): HttpError {
  return new HttpError(400, apiError(error, fix));
}

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(parsed.hostname) && Number(parsed.port || 80) === port;
}

function setCors(res: ServerResponse, origin: string | undefined): void {
  res.setHeader("Vary", "Origin");
  if (origin && EXTENSION_ORIGIN.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    `Content-Type, ${TOKEN_HEADER}, ${PROTOCOL_HEADER}`,
  );
  res.setHeader("Access-Control-Max-Age", "600");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Context): Promise<void> {
  const origin = header(req, "origin");
  setCors(res, origin);

  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (!hostAllowed(header(req, "host"), ctx.port)) {
    throw forbidden("Open Northstar from the browser extension on a localhost page.");
  }

  const serverOrigin = `http://${header(req, "host")}`;
  const pairConfirm = method === "POST" && pathname === `${PAIR_PATH}/confirm`;
  const extension = origin !== undefined && EXTENSION_ORIGIN.test(origin);

  if (method === "OPTIONS") {
    if (!extension) throw forbidden("Use the Northstar browser extension.");
    res.writeHead(204).end();
    return;
  }

  if (pairConfirm) {
    const sameOrigin = origin === serverOrigin || header(req, "sec-fetch-site") === "same-origin";
    if (!sameOrigin) throw forbidden("Click Connect in the Northstar toolbar.");
  } else if (method === "GET" && pathname === PAIR_PATH) {
    if (origin !== undefined && origin !== serverOrigin) {
      throw forbidden("Click Connect in the Northstar toolbar.");
    }
  } else if (origin !== undefined && !extension) {
    throw forbidden("Use the Northstar browser extension.");
  }

  if (method === "GET" && pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: SERVICE_NAME,
      protocol: PROTOCOL_VERSION,
      version: VERSION,
      root: ctx.store.root,
      startedAt: ctx.broker.startedAt,
      paired: tokenMatches(ctx.token, header(req, TOKEN_HEADER)),
    });
    return;
  }

  if (method === "GET" && pathname === PAIR_PATH) {
    sendPairPage(res, ctx);
    return;
  }

  if (pairConfirm) {
    await confirmPair(req, res, ctx);
    return;
  }

  if (!tokenMatches(ctx.token, header(req, TOKEN_HEADER))) {
    throw new HttpError(
      401,
      apiError(
        "This browser is not connected to Northstar.",
        "Click Connect in the Northstar toolbar.",
      ),
    );
  }

  const protocol = header(req, PROTOCOL_HEADER);
  if (protocol !== undefined && Number(protocol) !== PROTOCOL_VERSION) {
    const older = Number(protocol) < PROTOCOL_VERSION;
    throw new HttpError(
      426,
      apiError(
        "The extension and the server versions differ.",
        older
          ? "Update the Northstar extension."
          : "Update Northstar with npx @pallandir/northstar install, then restart your agent.",
      ),
    );
  }

  if (method === "GET" && pathname === "/status") {
    json(res, 200, {
      notices: ctx.broker.pendingNotices,
      agent: await ctx.delivery.readiness(),
      open: (await ctx.store.list("open")).length,
      lastPolledAt: ctx.broker.lastPolledAt,
      handoff: ctx.broker.lastHandoff,
    });
    return;
  }

  if (method === "GET" && pathname === "/state") {
    const page = url.searchParams.get("page");
    json(res, 200, {
      version: ctx.broker.currentVersion,
      lastPolledAt: ctx.broker.lastPolledAt,
      comments: await ctx.store.list(undefined, page === null ? undefined : pageParam(page)),
      notices: ctx.broker.pendingNotices,
      agent: await ctx.delivery.readiness(),
    });
    return;
  }

  if (method === "GET" && pathname === "/comments") {
    const page = url.searchParams.get("page");
    if (page === null) {
      throw badRequest(
        "The page query parameter is missing.",
        "Send GET /comments?page=<page key>.",
      );
    }
    json(res, 200, await ctx.store.list(undefined, pageParam(page)));
    return;
  }

  if (method === "DELETE" && pathname === "/comments") {
    const page = url.searchParams.get("page");
    const all = url.searchParams.get("all") === "true";
    if ((page === null) === !all) {
      throw badRequest(
        "Pass either page or all=true, not both and not neither.",
        "Send DELETE /comments?page=<page key> or DELETE /comments?all=true.",
      );
    }
    const removed = await ctx.store.clear(all ? undefined : pageParam(page as string));
    if (removed > 0) ctx.broker.bump();
    ctx.log(`cleared ${removed} comment(s)${all ? "" : ` on ${page}`}`);
    json(res, 200, { removed });
    return;
  }

  if (method === "POST" && pathname === "/comments") {
    await postComments(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/handoff") {
    await handoff(res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/owns") {
    await owns(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/comments/reopen") {
    const body = await readJson(req);
    const id = field(body, "id");
    const note = body.note;
    if (typeof id !== "string" || id.length === 0) {
      throw badRequest("The id field is required.", "Send the id of the comment to reopen.");
    }
    if (note !== undefined && (typeof note !== "string" || note.length > LIMITS.note)) {
      throw badRequest(
        `The note must be text of at most ${LIMITS.note} characters.`,
        "Shorten the note and try again.",
      );
    }
    const outcome = await ctx.store.reopenWithNote(id, note);
    if (!outcome) {
      throw new HttpError(
        404,
        apiError("That comment no longer exists.", "Refresh the page to see the current comments."),
      );
    }
    if (!outcome.changed) {
      throw new HttpError(
        409,
        apiError("That comment is already open.", "Refresh the page to see its current state."),
      );
    }
    ctx.broker.bump();
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/notices/dismiss") {
    const body = await readJson(req);
    const commentId = field(body, "commentId");
    if (typeof commentId !== "string" || commentId.length === 0) {
      throw badRequest("The commentId field is required.", "Send the id of the notice to dismiss.");
    }
    ctx.broker.dismissNotice(commentId);
    json(res, 200, { ok: true });
    return;
  }

  throw notFound();
}

function pageParam(page: string): string {
  try {
    return pageKey(page);
  } catch {
    throw badRequest(
      "The page value is not a valid page key.",
      "Pass the page url, for example http://localhost:3000/users/1.",
    );
  }
}

function field(body: Record<string, unknown>, key: string): unknown {
  return body[key];
}

async function postComments(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
): Promise<void> {
  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw badRequest("The request body is not valid JSON.", "Update the Northstar extension.");
  }
  if (!Array.isArray(parsed)) {
    throw badRequest(
      "The request body must be a list of comments.",
      "Update the Northstar extension.",
    );
  }
  if (parsed.length === 0) {
    throw badRequest("The request has no comments.", "Add a comment before saving.");
  }
  if (parsed.length > LIMITS.batch) {
    throw badRequest(
      `The request has more than ${LIMITS.batch} comments.`,
      "Send fewer comments at once.",
    );
  }

  const checks = checkDrafts(parsed);
  const valid = checks.filter((c): c is DraftCheck & { draft: NonNullable<DraftCheck["draft"]> } =>
    Boolean(c.draft),
  );
  const rejected = checks.flatMap((c) => (c.rejection ? [c.rejection] : []));

  if (valid.length === 0) {
    ctx.log(`rejected ${rejected.length} comment(s)`);
    const first = rejected[0];
    json(res, 400, {
      ...apiError(first?.error ?? "No comment was valid.", first?.fix ?? DRAFT_FIX),
      rejected,
      accepted: [],
      ids: [],
    });
    return;
  }

  const outcomes = await ctx.store.ingestMany(valid.map((c) => c.draft));
  const accepted: { cid: string; id: string }[] = [];
  let fresh = 0;
  outcomes.forEach((outcome, i) => {
    if (!outcome.ok) {
      rejected.push(outcome.rejection);
      return;
    }
    accepted.push({ cid: (valid[i] as (typeof valid)[number]).draft.cid, id: outcome.comment.id });
    if (!outcome.duplicate) fresh += 1;
  });

  if (accepted.length === 0) {
    ctx.log(`rejected ${rejected.length} comment(s)`);
    const first = rejected[0] as Rejection;
    json(res, 400, {
      ...apiError(first.error, first.fix),
      rejected,
      accepted,
      ids: [],
    });
    return;
  }
  const ids = accepted.map((a) => a.id);
  if (fresh > 0) ctx.broker.bump();
  ctx.log(`ingested ${fresh} new comment(s): ${ids.join(", ")}`);

  const response: PostCommentsResponse = {
    ids,
    accepted,
    rejected,
  };
  json(res, 201, response);
}

async function handoff(res: ServerResponse, ctx: Context): Promise<void> {
  if (ctx.sending) {
    throw new HttpError(
      409,
      apiError("A send to the agent is already in progress.", "Wait for it to finish."),
    );
  }
  if ((await ctx.store.list("open")).length === 0) {
    throw badRequest(
      "There are no open comments to send.",
      "Add a comment, then click Send to AI.",
    );
  }
  ctx.sending = true;
  try {
    const outcome = await ctx.delivery.deliver();
    ctx.broker.recordHandoff(outcome);
    if (!outcome.delivered) ctx.log(`handoff failed: ${outcome.reason ?? "unknown"}`);
    json(res, 200, outcome);
  } finally {
    ctx.sending = false;
  }
}

async function owns(req: IncomingMessage, res: ServerResponse, ctx: Context): Promise<void> {
  const body = await readJson(req);
  const paths = field(body, "paths");
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > MAX_OWNS_PATHS ||
    !paths.every((p): p is string => typeof p === "string")
  ) {
    throw badRequest(
      `The paths field must be a list of 1 to ${MAX_OWNS_PATHS} source paths.`,
      "Update the Northstar extension.",
    );
  }
  const root = await realpath(ctx.store.root);
  let matches = 0;
  for (const raw of paths) {
    let relative: string;
    try {
      relative = sanitizeSourcePath(raw, root);
    } catch (error) {
      if (error instanceof SourcePathError) {
        throw badRequest(
          `A source path was refused, ${error.message}.`,
          "Update the Northstar extension.",
        );
      }
      throw error;
    }
    if (await isFileUnder(root, relative)) matches += 1;
  }
  const response: OwnsResponse = { matches, depth: root.split(sep).length };
  json(res, 200, response);
}

async function isFileUnder(root: string, relative: string): Promise<boolean> {
  let resolved: string;
  try {
    resolved = await realpath(join(root, relative));
  } catch {
    return false;
  }
  if (!resolved.startsWith(`${root}${sep}`)) return false;
  return (await stat(resolved)).isFile();
}

function sendPairPage(res: ServerResponse, ctx: Context): void {
  const now = Date.now();
  for (const [nonce, expires] of ctx.nonces) if (expires <= now) ctx.nonces.delete(nonce);
  while (ctx.nonces.size >= MAX_NONCES) {
    const oldest = ctx.nonces.keys().next().value as string;
    ctx.nonces.delete(oldest);
  }
  const nonce = randomBytes(24).toString("hex");
  ctx.nonces.set(nonce, now + NONCE_TTL_MS);
  const scriptNonce = randomBytes(16).toString("base64");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": pairCsp(scriptNonce),
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(pairPage({ project: basename(ctx.store.root), port: ctx.port, nonce, scriptNonce }));
}

async function confirmPair(req: IncomingMessage, res: ServerResponse, ctx: Context): Promise<void> {
  const body = await readJson(req);
  const nonce = field(body, "nonce");
  const expires = typeof nonce === "string" ? ctx.nonces.get(nonce) : undefined;
  if (typeof nonce === "string") ctx.nonces.delete(nonce);
  if (expires === undefined || expires <= Date.now()) {
    throw forbidden("Click Connect in the Northstar toolbar again.");
  }
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, { token: ctx.token });
}

class BodyTooLarge extends HttpError {
  constructor() {
    super(
      413,
      apiError(
        "The request is larger than 12 MB.",
        "Save fewer comments at once or turn off screenshots.",
      ),
    );
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("The request body is not valid JSON.", "Update the Northstar extension.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("The request body must be a JSON object.", "Update the Northstar extension.");
  }
  return parsed as Record<string, unknown>;
}

function sendError(res: ServerResponse, error: HttpError): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (error.status === 413) headers.Connection = "close";
  res.writeHead(error.status, headers);
  res.end(JSON.stringify(error.body));
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
        reject(
          new Error(
            `Every Northstar port is busy (${ports.join(", ")}). Close another agent session or set NORTHSTAR_PORT to a free port.`,
          ),
        );
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
        resolve((server.address() as { port: number } | null)?.port ?? (port as number));
      });
    };
    tryPort(0);
  });
}
