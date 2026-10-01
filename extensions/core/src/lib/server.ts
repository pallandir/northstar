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

export async function resolveLink(pageOrigin: string): Promise<Link> {
  const servers = await listServers();
  if (servers.length === 0) return { kind: "offline" };

  let server = servers[0];
  if (servers.length > 1) {
    const choice = (await readChoices())[pageOrigin];
    const chosen = servers.find((s) => s.port === choice);
    if (!chosen) return { kind: "choose", servers };
    server = chosen;
  }

  if (server.protocol !== PROTOCOL_VERSION) {
    return { kind: "mismatch", server, problem: mismatchProblem(server) };
  }
  const token = await getToken();
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
