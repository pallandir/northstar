import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import type { Socket } from "node:net";
import { join, sep } from "node:path";
import {
  ACTIONS,
  DRAFT_FIX,
  type DeferralNotice,
  type DraftCheck,
  type HandoffOutcome,
  type NativeAction,
  PROTOCOL_VERSION,
  type PostCommentsResponse,
  type ProjectInfo,
  type ProjectResolution,
  type Rejection,
  type SessionInfo,
  SourcePathError,
  type StatusResponse,
  type SystemInfo,
  type TemplateId,
  type UserConfig,
  actionParams,
  checkDrafts,
  pageKey,
  sanitizeSourcePath,
  templateLine,
} from "@northstar/protocol";
import { z } from "zod";
import {
  type AgentDefinition,
  describeAgents,
  findExecutable,
  mergeAgents,
  quickRunArgv,
} from "../agents/definitions.js";
import { userPath } from "../lib/user-path.js";
import type { DeliverOutcome } from "../pty/deliver.js";
import { CommentStore } from "../store.js";
import { ConfigError, loadSettings, updateSettings } from "../user-config.js";
import { Broker } from "./broker.js";
import {
  Registry,
  type SessionHandle,
  canonicalRoot,
  isDirectory,
  projectName,
} from "./registry.js";
import { NO_SESSION_FIX, readinessFor, routeSend } from "./router.js";
import { RpcError, RpcPeer } from "./rpc.js";

const PICKUP_TIMEOUT_MS = 20_000;
const MAX_OWNS_PATHS = 20;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface QuickRunSpec {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface QuickRunHandle {
  pid: number;
  onExit(callback: (code: number) => void): void;
}

export type QuickRunLauncher = (spec: QuickRunSpec) => QuickRunHandle;

interface DaemonOptions {
  home: string;
  version: string;
  log: (message: string) => void;
  launchQuickRun: QuickRunLauncher;
  onShutdown: () => void;
  pickupTimeoutMs?: number;
}

interface PeerContext {
  sessionIds: Set<string>;
  mcpRoot: string | null;
}

const registerParams = z
  .object({
    id: z.string().regex(SESSION_ID).optional(),
    agent: z.string().min(1).max(64),
    command: z.string().min(1).max(4096),
    cwd: z.string().min(1).max(4096),
    pid: z.number().int().positive(),
    agentPid: z.number().int().positive(),
  })
  .strict();

const helloParams = z
  .object({
    root: z.string().min(1).max(4096),
    ancestors: z.array(z.number().int().positive()).max(32),
  })
  .strict();

const noticeParams = z
  .object({
    commentId: z.string().min(1).max(200),
    page: z.string().max(4000),
    summary: z.string().max(500),
    createdAt: z.string().max(64),
  })
  .strict();

const activityParams = z.object({ id: z.string().regex(SESSION_ID) }).strict();

const requestParams = z
  .object({ action: z.string().max(64), params: z.unknown().optional() })
  .strict();

function badRequest(message: string, fix: string): RpcError {
  return new RpcError("BAD_REQUEST", message, fix);
}

function parseParams<K extends NativeAction>(
  action: K,
  params: unknown,
): z.infer<(typeof actionParams)[K]> {
  const result = actionParams[action].safeParse(params ?? {});
  if (!result.success) {
    const issue = result.error.issues[0] as z.ZodIssue;
    const where = issue.path.join(".") || "the request";
    throw badRequest(
      `The ${action} request is invalid at ${where}: ${issue.message}.`,
      "Update the Northstar extension and the Northstar package so both match.",
    );
  }
  return result.data as z.infer<(typeof actionParams)[K]>;
}

function parseInternal<S extends z.ZodTypeAny>(schema: S, method: string, params: unknown) {
  const result = schema.safeParse(params);
  if (!result.success) {
    const issue = result.error.issues[0] as z.ZodIssue;
    throw badRequest(
      `The ${method} call is invalid at ${issue.path.join(".") || "the request"}: ${issue.message}.`,
      "Update Northstar.",
    );
  }
  return result.data as z.infer<S>;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capital.endsWith(".") ? capital : `${capital}.`;
}

async function isFileUnder(root: string, relative: string): Promise<boolean> {
  let resolved: string;
  try {
    resolved = await realpath(join(root, relative));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!resolved.startsWith(`${root}${sep}`)) return false;
  return (await stat(resolved)).isFile();
}

function pageWithoutScheme(page: string): string | null {
  try {
    const url = new URL(page);
    return `${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

export class Daemon {
  readonly startedAt = new Date().toISOString();
  readonly registry: Registry;
  private readonly brokers = new Map<string, Broker>();
  private readonly stores = new Map<string, CommentStore>();
  private readonly sending = new Set<string>();
  private readonly peers = new Set<RpcPeer>();

  constructor(private readonly options: DaemonOptions) {
    this.registry = new Registry(options.home, options.log);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  attach(socket: Socket): RpcPeer {
    const context: PeerContext = { sessionIds: new Set(), mcpRoot: null };
    const peer: RpcPeer = new RpcPeer(
      socket,
      (method, params) => this.dispatch(peer, context, method, params),
      this.options.log,
    );
    this.peers.add(peer);
    peer.onClose(() => {
      this.peers.delete(peer);
      for (const id of context.sessionIds) {
        this.registry.remove(id);
        this.options.log(`session.closed session=${id}`);
      }
    });
    return peer;
  }

  private async dispatch(
    peer: RpcPeer,
    context: PeerContext,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    switch (method) {
      case "request": {
        const { action, params: inner } = parseInternal(requestParams, method, params);
        return this.request(action, inner);
      }
      case "session.register":
        return this.registerSession(peer, context, parseInternal(registerParams, method, params));
      case "session.activity": {
        const { id } = parseInternal(activityParams, method, params);
        if (context.sessionIds.has(id)) this.registry.touch(id);
        return {};
      }
      case "mcp.hello":
        return this.hello(context, parseInternal(helloParams, method, params));
      case "broker.polled":
        this.brokerOf(context).markPolled();
        return {};
      case "broker.bump":
        this.brokerOf(context).bump();
        return {};
      case "broker.notice":
        this.brokerOf(context).pushNotice(
          parseInternal(noticeParams, method, params) as DeferralNotice,
        );
        return {};
      case "daemon.shutdown":
        this.options.log("shutdown requested");
        setImmediate(() => this.options.onShutdown());
        return {};
      default:
        throw new RpcError(
          "UNSUPPORTED_ACTION",
          `The daemon does not serve ${method}.`,
          "Update Northstar.",
        );
    }
  }

  private brokerOf(context: PeerContext): Broker {
    if (!context.mcpRoot) {
      throw badRequest(
        "This connection has not said which project it serves.",
        "Update Northstar.",
      );
    }
    return this.broker(context.mcpRoot);
  }

  private broker(root: string): Broker {
    let broker = this.brokers.get(root);
    if (!broker) {
      broker = new Broker();
      this.brokers.set(root, broker);
    }
    return broker;
  }

  private storeFor(root: string): CommentStore {
    let store = this.stores.get(root);
    if (!store) {
      store = new CommentStore(root);
      this.stores.set(root, store);
    }
    return store;
  }

  private registerSession(
    peer: RpcPeer,
    context: PeerContext,
    params: z.infer<typeof registerParams>,
  ): { id: string; version: string; protocol: number } {
    const id = params.id ?? randomUUID();
    const existing = this.registry.get(id);
    if (existing) {
      throw badRequest(
        `A session with id ${id} is already registered.`,
        "Start the agent again through northstar run.",
      );
    }
    let root: string;
    try {
      root = canonicalRoot(params.cwd);
    } catch (error) {
      throw badRequest(
        `The working directory ${params.cwd} cannot be read: ${(error as Error).message}.`,
        "Run northstar run from an existing project directory.",
      );
    }
    const settings = loadSettings(this.options.home);
    const definition = mergeAgents(settings.agents).find((a) => a.id === params.agent);
    const now = new Date().toISOString();
    const info: SessionInfo = {
      id,
      agent: params.agent,
      name: definition?.name ?? params.agent,
      command: params.command,
      cwd: params.cwd,
      root,
      pid: params.pid,
      createdAt: now,
      lastActivityAt: now,
      kind: "interactive",
    };
    const handle: SessionHandle = {
      info,
      agentPid: params.agentPid,
      deliver: async (template) =>
        (await peer.call("session.deliver", { template })) as DeliverOutcome,
    };
    this.registry.add(handle);
    context.sessionIds.add(id);
    this.options.log(`session.created session=${id} agent=${params.agent} pid=${params.pid}`);
    return { id, version: this.options.version, protocol: PROTOCOL_VERSION };
  }

  private hello(
    context: PeerContext,
    params: z.infer<typeof helloParams>,
  ): { session: string | null } {
    let root: string;
    try {
      root = canonicalRoot(params.root);
    } catch (error) {
      throw badRequest(
        `The project root ${params.root} cannot be read: ${(error as Error).message}.`,
        "Start the agent in an existing project directory.",
      );
    }
    context.mcpRoot = root;
    this.registry.rememberRoot(root);
    const bound = this.registry.bindRoot(params.ancestors, root);
    this.options.log(`mcp.hello root=${root} session=${bound?.id ?? "none"}`);
    return { session: bound?.id ?? null };
  }

  async request(action: string, params: unknown): Promise<unknown> {
    try {
      return await this.route(action, params);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new RpcError(
          "BAD_REQUEST",
          error.message,
          "Fix that file or delete it, then try again.",
        );
      }
      throw error;
    }
  }

  private async route(action: string, params: unknown): Promise<unknown> {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      throw new RpcError(
        "UNSUPPORTED_ACTION",
        `Northstar does not know the action ${action}.`,
        "Update the Northstar extension and the Northstar package so both match.",
      );
    }
    switch (action as NativeAction) {
      case "system.info":
        parseParams("system.info", params);
        return {
          version: this.options.version,
          protocol: PROTOCOL_VERSION,
          pid: process.pid,
          startedAt: this.startedAt,
        } satisfies SystemInfo;
      case "agent.list": {
        parseParams("agent.list", params);
        const settings = loadSettings(this.options.home);
        return describeAgents(mergeAgents(settings.agents), userPath(this.options.home));
      }
      case "session.list":
        parseParams("session.list", params);
        return this.registry.list();
      case "project.list":
        parseParams("project.list", params);
        return this.projects();
      case "project.resolve":
        return this.resolveProject(parseParams("project.resolve", params));
      case "status.get":
        return this.status(parseParams("status.get", params).root);
      case "session.send":
        return this.sessionSend(parseParams("session.send", params));
      case "quickrun.execute":
        return this.quickRun(parseParams("quickrun.execute", params));
      case "comments.list": {
        const { root, page } = parseParams("comments.list", params);
        return this.storeFor(this.requireRoot(root)).list(undefined, this.pageParam(page));
      }
      case "comments.add": {
        const { root, drafts } = parseParams("comments.add", params);
        return this.addComments(this.requireRoot(root), drafts);
      }
      case "comments.clear": {
        const { root, page, all } = parseParams("comments.clear", params);
        const canonical = this.requireRoot(root);
        if ((page === undefined) === !all) {
          throw badRequest(
            "Pass either page or all, not both and not neither.",
            "Update the Northstar extension.",
          );
        }
        const removed = await this.storeFor(canonical).clear(
          all ? undefined : this.pageParam(page as string),
        );
        if (removed > 0) this.broker(canonical).bump();
        this.options.log(`comments.cleared count=${removed}`);
        return { removed };
      }
      case "comments.reopen": {
        const { root, id, note } = parseParams("comments.reopen", params);
        const canonical = this.requireRoot(root);
        const outcome = await this.storeFor(canonical).reopenWithNote(id, note);
        if (!outcome) {
          throw badRequest(
            "That comment no longer exists.",
            "Refresh the page to see the current comments.",
          );
        }
        if (!outcome.changed) {
          throw badRequest(
            "That comment is already open.",
            "Refresh the page to see its current state.",
          );
        }
        this.broker(canonical).bump();
        return {};
      }
      case "notices.dismiss": {
        const { root, commentId } = parseParams("notices.dismiss", params);
        this.broker(this.requireRoot(root)).dismissNotice(commentId);
        return {};
      }
      case "config.get":
        parseParams("config.get", params);
        return this.config();
      case "config.set": {
        const change = parseParams("config.set", params);
        updateSettings(this.options.home, change);
        return this.config();
      }
    }
  }

  private config(): UserConfig {
    const settings = loadSettings(this.options.home);
    return {
      preferredAgent: settings.preferredAgent,
      template: settings.template,
      projects: settings.projects,
    };
  }

  private pageParam(page: string): string {
    try {
      return pageKey(page);
    } catch {
      throw badRequest(
        "The page value is not a valid page key.",
        "Pass the page url, for example http://localhost:3000/users/1.",
      );
    }
  }

  private allRoots(): string[] {
    const roots = new Set(this.registry.knownRoots());
    const settings = loadSettings(this.options.home);
    for (const directory of Object.values(settings.projects)) {
      if (isDirectory(directory)) roots.add(canonicalRoot(directory));
    }
    return [...roots];
  }

  private requireRoot(root: string): string {
    let canonical: string;
    try {
      canonical = canonicalRoot(root);
    } catch {
      throw new RpcError(
        "NO_PROJECT",
        `Northstar can not read the project ${root}.`,
        "Start your agent in that project with northstar run.",
      );
    }
    if (!this.allRoots().includes(canonical)) {
      throw new RpcError(
        "NO_PROJECT",
        `Northstar does not know the project ${canonical}.`,
        "Start your agent in that project with northstar run, or map it in northstar config.",
      );
    }
    return canonical;
  }

  private projects(): ProjectInfo[] {
    const sessions = this.registry.list();
    return this.allRoots().map((root) => ({
      root,
      name: projectName(root),
      sessions: sessions.filter((s) => s.root === root && s.kind === "interactive").length,
    }));
  }

  private async resolveProject(
    params: z.infer<(typeof actionParams)["project.resolve"]>,
  ): Promise<ProjectResolution> {
    const owners: ProjectResolution["owners"] = [];
    if (params.paths.length > MAX_OWNS_PATHS) {
      throw badRequest(
        `The paths field holds at most ${MAX_OWNS_PATHS} source paths.`,
        "Update the Northstar extension.",
      );
    }
    for (const root of this.allRoots()) {
      let matches = 0;
      for (const raw of params.paths) {
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
      owners.push({ root, matches, depth: root.split(sep).length });
    }
    return { owners, mapped: this.mappedRoot(params.page) };
  }

  private mappedRoot(page: string | undefined): string | null {
    if (page === undefined) return null;
    const plain = pageWithoutScheme(page);
    if (plain === null) return null;
    const settings = loadSettings(this.options.home);
    const keys = Object.keys(settings.projects).sort((a, b) => b.length - a.length);
    const key = keys.find((k) => plain === k || plain.startsWith(`${k}/`));
    if (key === undefined) return null;
    const directory = settings.projects[key] as string;
    return isDirectory(directory) ? canonicalRoot(directory) : null;
  }

  private async status(rootParam: string): Promise<StatusResponse> {
    const root = this.requireRoot(rootParam);
    const broker = this.broker(root);
    const settings = loadSettings(this.options.home);
    return {
      notices: broker.pendingNotices,
      readiness: readinessFor(this.registry.list(), {
        root,
        preferredAgent: settings.preferredAgent,
      }),
      open: (await this.storeFor(root).list("open")).length,
      lastPolledAt: broker.lastPolledAt,
      handoff: broker.lastHandoff,
    };
  }

  private async addComments(root: string, drafts: unknown[]): Promise<PostCommentsResponse> {
    const checks = checkDrafts(drafts);
    const valid = checks.filter(
      (c): c is DraftCheck & { draft: NonNullable<DraftCheck["draft"]> } => Boolean(c.draft),
    );
    const rejected: Rejection[] = checks.flatMap((c) => (c.rejection ? [c.rejection] : []));
    if (valid.length === 0) {
      this.options.log(`comments.rejected count=${rejected.length}`);
      return { ids: [], accepted: [], rejected: rejected.length ? rejected : [noDraft()] };
    }
    const outcomes = await this.storeFor(root).ingestMany(valid.map((c) => c.draft));
    const accepted: PostCommentsResponse["accepted"] = [];
    let fresh = 0;
    outcomes.forEach((outcome, i) => {
      if (!outcome.ok) {
        rejected.push(outcome.rejection);
        return;
      }
      accepted.push({
        cid: (valid[i] as (typeof valid)[number]).draft.cid,
        id: outcome.comment.id,
      });
      if (!outcome.duplicate) fresh += 1;
    });
    if (fresh > 0) this.broker(root).bump();
    this.options.log(`comments.ingested new=${fresh} rejected=${rejected.length}`);
    return { ids: accepted.map((a) => a.id), accepted, rejected };
  }

  private async sessionSend(
    params: z.infer<(typeof actionParams)["session.send"]>,
  ): Promise<HandoffOutcome> {
    const root = this.requireRoot(params.root);
    if (this.sending.has(root)) {
      throw new RpcError(
        "BLOCKED",
        "A send to the agent is already in progress.",
        "Wait for it to finish.",
      );
    }
    if ((await this.storeFor(root).list("open")).length === 0) {
      throw badRequest(
        "There are no open comments to send.",
        "Add a comment, then click Send to AI.",
      );
    }
    const settings = loadSettings(this.options.home);
    const route = routeSend(this.registry.list(), {
      root,
      sessionId: params.sessionId,
      preferredAgent: settings.preferredAgent,
    });
    if (route.kind === "none") {
      throw new RpcError(
        "NO_SESSION",
        "No agent session is running in this project.",
        NO_SESSION_FIX,
      );
    }
    if (route.kind === "pick") {
      throw new RpcError(
        "PICK_SESSION",
        "More than one agent session is running in this project.",
        "Pick the session to send to.",
      );
    }
    if (route.kind === "missing") {
      throw new RpcError(
        "SESSION_NOT_FOUND",
        "That session is no longer running.",
        "Pick one of the running sessions.",
      );
    }
    const handle = this.registry.get(route.session.id) as SessionHandle;
    this.sending.add(root);
    try {
      const started = Date.now();
      const outcome = await this.deliver(handle, params.template);
      const handoff = await this.confirm(root, handle.info, outcome, started);
      this.broker(root).recordHandoff(handoff);
      this.options.log(
        `session.send session=${handle.info.id} agent=${handle.info.agent} delivered=${handoff.delivered} duration=${Date.now() - started}ms`,
      );
      return handoff;
    } finally {
      this.sending.delete(root);
    }
  }

  private async deliver(handle: SessionHandle, template: TemplateId): Promise<DeliverOutcome> {
    try {
      return await handle.deliver(template);
    } catch (error) {
      if (error instanceof RpcError && error.code === "DAEMON_UNAVAILABLE") {
        this.registry.remove(handle.info.id);
        throw new RpcError(
          "SESSION_NOT_FOUND",
          "That session ended before Northstar could write to it.",
          "Pick one of the running sessions.",
        );
      }
      throw error;
    }
  }

  private async confirm(
    root: string,
    session: SessionInfo,
    outcome: DeliverOutcome,
    sentAt: number,
  ): Promise<HandoffOutcome> {
    const who = { id: session.id, agent: session.agent, name: session.name };
    const at = new Date().toISOString();
    if (!outcome.delivered) {
      return {
        delivered: false,
        session: who,
        blocked: outcome.blocked,
        reason: sentence(`Northstar did not write to ${session.name}, ${outcome.reason}`),
        fix: outcome.fix,
        at,
      };
    }
    const timeout = this.options.pickupTimeoutMs ?? PICKUP_TIMEOUT_MS;
    if (await this.broker(root).waitForPoll(sentAt, timeout)) {
      return { delivered: true, session: who, at: new Date().toISOString() };
    }
    return {
      delivered: false,
      session: who,
      reason: `${session.name} did not start on the comments within ${Math.round(timeout / 1000)} seconds.`,
      fix: `Check ${session.name} for a pending prompt or a running task, then click Send to AI again.`,
      at: new Date().toISOString(),
    };
  }

  private async quickRun(
    params: z.infer<(typeof actionParams)["quickrun.execute"]>,
  ): Promise<HandoffOutcome> {
    const root = this.requireRoot(params.root);
    if (this.sending.has(root)) {
      throw new RpcError(
        "BLOCKED",
        "A send to the agent is already in progress.",
        "Wait for it to finish.",
      );
    }
    const live = this.registry.list().filter((s) => s.root === root);
    if (live.length > 0) {
      throw new RpcError(
        "BLOCKED",
        "An agent session is already running in this project.",
        "Use Send to AI, quick run is only for projects with no session.",
      );
    }
    if ((await this.storeFor(root).list("open")).length === 0) {
      throw badRequest(
        "There are no open comments to send.",
        "Add a comment, then click Send to AI.",
      );
    }
    const settings = loadSettings(this.options.home);
    const definition = mergeAgents(settings.agents).find((a) => a.id === params.agent);
    if (!definition) {
      throw badRequest(
        `Northstar does not know the agent ${params.agent}.`,
        "Pick one from the list.",
      );
    }
    const path = userPath(this.options.home);
    const file = findExecutable(definition.executable, path);
    if (!file) {
      throw badRequest(
        `${definition.name} is not installed, ${definition.executable} is not on the PATH Northstar knows.`,
        "Install it, or run northstar run once from a shell that has it on the PATH.",
      );
    }
    let argv: string[];
    try {
      argv = quickRunArgv(definition, templateLine(params.template));
    } catch (error) {
      throw badRequest((error as Error).message, "Pick an agent with a quick run command.");
    }
    this.sending.add(root);
    try {
      return await this.runHeadless(root, definition, file, argv, path);
    } finally {
      this.sending.delete(root);
    }
  }

  private async runHeadless(
    root: string,
    definition: AgentDefinition,
    file: string,
    argv: string[],
    path: string,
  ): Promise<HandoffOutcome> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.PATH = path;
    const sentAt = Date.now();
    const handle = this.options.launchQuickRun({ file, args: argv, cwd: root, env });
    const id = randomUUID();
    const now = new Date().toISOString();
    const info: SessionInfo = {
      id,
      agent: definition.id,
      name: definition.name,
      command: file,
      cwd: root,
      root,
      pid: handle.pid,
      createdAt: now,
      lastActivityAt: now,
      kind: "quick-run",
    };
    this.registry.add({
      info,
      agentPid: handle.pid,
      deliver: async () => {
        throw new RpcError("BLOCKED", "A quick run takes no messages.", "Wait for it to finish.");
      },
    });
    const who = { id, agent: definition.id, name: definition.name };
    const exited = new Promise<number>((resolve) => handle.onExit(resolve));
    void exited.then((code) => {
      this.registry.remove(id);
      this.options.log(`quickrun.exited session=${id} agent=${definition.id} code=${code}`);
    });
    const timeout = this.options.pickupTimeoutMs ?? PICKUP_TIMEOUT_MS;
    const winner = await Promise.race([
      this.broker(root)
        .waitForPoll(sentAt, timeout)
        .then((polled) => (polled ? ("polled" as const) : ("timeout" as const))),
      exited.then(() => "exited" as const),
    ]);
    const at = new Date().toISOString();
    let handoff: HandoffOutcome;
    if (winner === "polled") {
      handoff = { delivered: true, session: who, at };
    } else if (winner === "exited") {
      handoff = {
        delivered: false,
        session: who,
        reason: `${definition.name} exited before it read the comments.`,
        fix: "Run it once in a terminal to see its error, then try again.",
        at,
      };
    } else {
      handoff = {
        delivered: false,
        session: who,
        reason: `${definition.name} did not start on the comments within ${Math.round(timeout / 1000)} seconds.`,
        fix: "Check that its Northstar MCP server is installed with northstar doctor.",
        at,
      };
    }
    this.broker(root).recordHandoff(handoff);
    this.options.log(
      `quickrun.started session=${id} agent=${definition.id} delivered=${handoff.delivered}`,
    );
    return handoff;
  }

  closeAll(): void {
    for (const peer of this.peers) peer.close();
  }
}

function noDraft(): Rejection {
  return {
    cid: null,
    field: "comment",
    error: "No comment was valid.",
    fix: DRAFT_FIX,
  };
}
