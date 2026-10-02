import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import {
  ACTIONS,
  type DeferralNotice,
  type NativeAction,
  PROTOCOL_VERSION,
  type SessionInfo,
  type SystemInfo,
  type UserConfig,
  actionParams,
} from "@northstar/protocol";
import { z } from "zod";
import { describeAgents, mergeAgents } from "../agents/definitions.js";
import { userPath } from "../lib/user-path.js";
import type { DeliverOutcome } from "../pty/deliver.js";
import { loadSettings, updateSettings } from "../user-config.js";
import { ConfigError } from "../user-config.js";
import { CommentActions } from "./comments.js";
import { type SessionHandle, canonicalRoot } from "./registry.js";
import { RpcError, RpcPeer, badRequest } from "./rpc.js";
import { type QuickRunLauncher, Sender } from "./sending.js";
import { Workspace } from "./workspace.js";

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

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

export class Daemon {
  readonly startedAt = new Date().toISOString();
  readonly workspace: Workspace;
  private readonly comments: CommentActions;
  private readonly sender: Sender;
  private readonly peers = new Set<RpcPeer>();

  constructor(private readonly options: DaemonOptions) {
    this.workspace = new Workspace(options.home, options.log);
    this.comments = new CommentActions(this.workspace, options.log);
    this.sender = new Sender(this.workspace, options, options.log);
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
        this.workspace.registry.remove(id);
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
        if (context.sessionIds.has(id)) this.workspace.registry.touch(id);
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

  private brokerOf(context: PeerContext) {
    if (!context.mcpRoot) {
      throw badRequest(
        "This connection has not said which project it serves.",
        "Update Northstar.",
      );
    }
    return this.workspace.broker(context.mcpRoot);
  }

  private registerSession(
    peer: RpcPeer,
    context: PeerContext,
    params: z.infer<typeof registerParams>,
  ): { id: string; version: string; protocol: number } {
    const id = params.id ?? randomUUID();
    if (this.workspace.registry.get(id)) {
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
      deliver: async (template) =>
        (await peer.call("session.deliver", { template })) as DeliverOutcome,
    };
    this.workspace.registry.add(handle);
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
    this.workspace.registry.rememberRoot(root);
    const bound = this.workspace.registry.bindRoot(params.ancestors, root);
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
    const home = this.options.home;
    switch (action as NativeAction) {
      case "system.info":
        parseParams("system.info", params);
        return {
          version: this.options.version,
          protocol: PROTOCOL_VERSION,
          pid: process.pid,
          startedAt: this.startedAt,
        } satisfies SystemInfo;
      case "agent.list":
        parseParams("agent.list", params);
        return describeAgents(mergeAgents(loadSettings(home).agents), userPath(home));
      case "session.list":
        parseParams("session.list", params);
        return this.workspace.registry.list();
      case "project.list":
        parseParams("project.list", params);
        return this.workspace.projects();
      case "project.resolve":
        return this.workspace.resolveProject(parseParams("project.resolve", params));
      case "status.get":
        return this.comments.status(parseParams("status.get", params));
      case "session.send":
        return this.sender.send(parseParams("session.send", params));
      case "quickrun.execute":
        return this.sender.quickRun(parseParams("quickrun.execute", params));
      case "comments.list":
        return this.comments.list(parseParams("comments.list", params));
      case "comments.add":
        return this.comments.add(parseParams("comments.add", params));
      case "comments.clear":
        return this.comments.clear(parseParams("comments.clear", params));
      case "comments.reopen":
        return this.comments.reopen(parseParams("comments.reopen", params));
      case "notices.dismiss":
        return this.comments.dismissNotice(parseParams("notices.dismiss", params));
      case "config.get":
        parseParams("config.get", params);
        return this.config();
      case "config.set": {
        updateSettings(home, parseParams("config.set", params));
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

  closeAll(): void {
    for (const peer of this.peers) peer.close();
  }
}
