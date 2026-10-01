import {
  HEALTH_PATH,
  PROTOCOL_VERSION,
  SERVER_PORTS,
  SERVICE_NAME,
  TOKEN_HEADER,
  isApiError,
} from "@northstar/protocol";
import type { ProblemNote, ServerChoice } from "../messages.js";
import { browser } from "./browser.js";
import { UserError } from "./errors.js";

const TOKEN_KEY = "northstar-token";
const CHOICE_KEY = "northstar-server-choice";
const SOURCES_KEY = "northstar-page-sources";
const HEALTH_TIMEOUT_MS = 400;
const CACHE_TTL_MS = 30_000;

export interface ServerInfo {
  port: number;
  root: string;
  startedAt: string;
  protocol: number;
}

export type Link =
  | { kind: "offline" }
  | { kind: "choose"; servers: ServerInfo[] }
  | { kind: "mismatch"; server: ServerInfo; problem: ProblemNote }
  | { kind: "unpaired"; server: ServerInfo }
  | { kind: "connected"; server: ServerInfo; token: string };

export class ApiFailure extends UserError {
  constructor(
    message: string,
    fix: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message, fix, "api");
    this.name = "ApiFailure";
  }
}

let cache: { servers: ServerInfo[]; at: number } | null = null;

export function forgetServers(): void {
  cache = null;
  bindings.clear();
}

export function projectName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

export function toChoices(servers: ServerInfo[]): ServerChoice[] {
  return servers.map((s) => ({ port: s.port, project: projectName(s.root) }));
}

function origin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function pairUrl(port: number, path: string): string {
  return `${origin(port)}${path}`;
}

async function probe(port: number): Promise<ServerInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${origin(port)}${HEALTH_PATH}`, { signal: ctrl.signal });
  } catch {
    // A closed or silent port is the normal answer when no server runs there.
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Another application answered on this port.
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const health = body as Record<string, unknown>;
  if (health.service !== SERVICE_NAME) return null;
  if (typeof health.root !== "string" || typeof health.startedAt !== "string") {
    throw new UserError(
      "A Northstar server answered with an unreadable health report.",
      "Update the Northstar server, then restart your AI agent.",
    );
  }
  return {
    port,
    root: health.root,
    startedAt: health.startedAt,
    protocol: typeof health.protocol === "number" ? health.protocol : 0,
  };
}

export async function listServers(): Promise<ServerInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.servers;
  const found = (await Promise.all(SERVER_PORTS.map(probe))).filter(
    (s): s is ServerInfo => s !== null,
  );
  cache = { servers: found, at: Date.now() };
  return found;
}

export async function getToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token: unknown = stored[TOKEN_KEY];
  return typeof token === "string" && token ? token : null;
}

export function setToken(token: string): Promise<void> {
  return browser.storage.local.set({ [TOKEN_KEY]: token });
}

export function clearToken(): Promise<void> {
  return browser.storage.local.remove(TOKEN_KEY);
}

async function readChoices(): Promise<Record<string, number>> {
  const stored = await browser.storage.local.get(CHOICE_KEY);
  const choices: unknown = stored[CHOICE_KEY];
  return typeof choices === "object" && choices !== null ? (choices as Record<string, number>) : {};
}

export async function chooseServer(pageOrigin: string, port: number): Promise<void> {
  const servers = await listServers();
  if (!servers.some((s) => s.port === port)) {
    throw new UserError(
      "That Northstar server is no longer running.",
      "Pick another one.",
      "choose",
    );
  }
  const choices = await readChoices();
  await browser.storage.local.set({ [CHOICE_KEY]: { ...choices, [pageOrigin]: port } });
}

export function mismatchProblem(server: ServerInfo): ProblemNote {
  const older = server.protocol < PROTOCOL_VERSION ? "server" : "extension";
  return {
    error: "Update Northstar: the extension and the server versions differ.",
    fix:
      older === "server"
        ? "Update the Northstar server, then restart your AI agent."
        : "Update the Northstar browser extension.",
  };
}

interface Binding {
  port: number;
  key: string;
  at: number;
}

const bindings = new Map<string, Binding>();

export async function reportSources(pageOrigin: string, paths: string[]): Promise<void> {
  const stored = await browser.storage.local.get(SOURCES_KEY);
  const all: unknown = stored[SOURCES_KEY];
  const known = typeof all === "object" && all !== null ? (all as Record<string, string[]>) : {};
  if (known[pageOrigin]?.join("\n") === paths.join("\n")) return;
  await browser.storage.local.set({ [SOURCES_KEY]: { ...known, [pageOrigin]: paths } });
}

async function readSources(pageOrigin: string): Promise<string[]> {
  const stored = await browser.storage.local.get(SOURCES_KEY);
  const all: unknown = stored[SOURCES_KEY];
  const paths =
    typeof all === "object" && all !== null ? (all as Record<string, unknown>)[pageOrigin] : null;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
}

interface Ownership {
  matches: number;
  depth: number;
}

async function ownership(server: ServerInfo, token: string, paths: string[]): Promise<Ownership> {
  const body = await callServer({ kind: "connected", server, token }, "POST", "/owns", { paths });
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Ownership).matches !== "number" ||
    typeof (body as Ownership).depth !== "number"
  ) {
    throw new UserError(
      "The Northstar server sent an unreadable answer.",
      "Update the Northstar server, then restart your AI agent.",
    );
  }
  return body as Ownership;
}

async function bindBySource(
  pageOrigin: string,
  servers: ServerInfo[],
  token: string,
): Promise<ServerInfo | null> {
  const paths = await readSources(pageOrigin);
  if (paths.length > 0) {
    const key = paths.join("\n");
    const bound = bindings.get(pageOrigin);
    const stillRunning = bound && servers.find((s) => s.port === bound.port);
    if (bound && stillRunning && bound.key === key && Date.now() - bound.at < CACHE_TTL_MS) {
      return stillRunning;
    }
    const owned = await Promise.all(
      servers.map(async (server) => ({ server, ...(await ownership(server, token, paths)) })),
    );
    const hits = owned
      .filter((o) => o.matches > 0)
      .sort((a, b) => b.matches - a.matches || b.depth - a.depth);
    const [best, runnerUp] = hits;
    if (best && !(runnerUp && runnerUp.matches === best.matches && runnerUp.depth === best.depth)) {
      bindings.set(pageOrigin, { port: best.server.port, key, at: Date.now() });
      return best.server;
    }
  }
  bindings.delete(pageOrigin);
  const choice = (await readChoices())[pageOrigin];
  return servers.find((s) => s.port === choice) ?? null;
}

export async function resolveLink(pageOrigin: string): Promise<Link> {
  const servers = await listServers();
  if (servers.length === 0) return { kind: "offline" };

  const compatible = servers.filter((s) => s.protocol === PROTOCOL_VERSION);
  if (compatible.length === 0) {
    const stale = servers[0] as ServerInfo;
    return { kind: "mismatch", server: stale, problem: mismatchProblem(stale) };
  }

  const token = await getToken();
  let server = compatible[0] as ServerInfo;
  if (compatible.length > 1) {
    if (!token) return { kind: "unpaired", server };
    try {
      const bound = await bindBySource(pageOrigin, compatible, token);
      if (!bound) return { kind: "choose", servers: compatible };
      server = bound;
    } catch (err) {
      if (err instanceof UserError && err.kind === "unpaired") return { kind: "unpaired", server };
      throw err;
    }
  }
  if (!token) return { kind: "unpaired", server };
  return { kind: "connected", server, token };
}

const unauthorized = (): UserError =>
  new UserError(
    "This browser is not connected to Northstar.",
    "Click Connect in the Northstar toolbar.",
    "unpaired",
  );

export async function callServer(
  link: Extract<Link, { kind: "connected" }>,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { [TOKEN_HEADER]: link.token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${origin(link.server.port)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    forgetServers();
    console.error("[northstar] request failed", err);
    throw new UserError(
      "The Northstar server stopped responding.",
      "Start your AI agent in the project, then retry.",
      "offline",
    );
  }

  let parsed: unknown = null;
  if (res.status !== 204) {
    try {
      parsed = await res.json();
    } catch (err) {
      console.error("[northstar] unreadable response", err);
      if (res.ok) {
        throw new UserError(
          "The Northstar server sent an unreadable answer.",
          "Restart your AI agent and retry.",
        );
      }
    }
  }

  if (res.ok) return parsed;
  if (res.status === 401) {
    await clearToken();
    throw unauthorized();
  }
  if (isApiError(parsed)) throw new ApiFailure(parsed.error, parsed.fix, res.status, parsed);
  throw new ApiFailure(
    `The Northstar server answered with status ${res.status}.`,
    "Restart your AI agent and retry.",
    res.status,
    parsed,
  );
}

export const offlineError = (): UserError =>
  new UserError(
    "No Northstar server is running.",
    "Start your AI agent in the project you are commenting on.",
    "offline",
  );

export function requireConnected(link: Link): Extract<Link, { kind: "connected" }> {
  switch (link.kind) {
    case "connected":
      return link;
    case "offline":
      throw offlineError();
    case "unpaired":
      throw unauthorized();
    case "choose":
      throw new UserError(
        "More than one Northstar server is running.",
        "Pick the project in the Northstar toolbar.",
        "choose",
      );
    case "mismatch":
      throw new UserError(link.problem.error, link.problem.fix, "mismatch");
  }
}
