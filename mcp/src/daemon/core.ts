import type { Socket } from "node:net";
import {
  ACTIONS,
  type DeferralNotice,
  type NativeAction,
  PROTOCOL_VERSION,
  type SystemInfo,
  type UserConfig,
  actionParams,
} from "@northstar/protocol";
import { z } from "zod";
import { allowLocalExtensions } from "../install/native-manifest.js";
import { loadSettings, updateSettings } from "../user-config.js";
import { ConfigError } from "../user-config.js";
import { CommentActions } from "./comments.js";
import { canonicalRoot } from "./registry.js";
import { RpcError, RpcPeer, badRequest } from "./rpc.js";
import { Sender } from "./sending.js";
import { Workspace } from "./workspace.js";

interface DaemonOptions {
  home: string;
  version: string;
  log: (message: string) => void;
  onShutdown: () => void;
}

interface PeerContext {
  mcpRoot: string | null;
  releaseAssistant: (() => void) | null;
  aborts: AbortController;
}

const helloParams = z.object({ root: z.string().min(1).max(4096) }).strict();

const noticeParams = z
  .object({
    commentId: z.string().min(1).max(200),
    page: z.string().max(4000),
    summary: z.string().max(500),
    createdAt: z.string().max(64),
  })
  .strict();

const listenParams = z
  .object({ root: z.string().min(1).max(4096), timeoutMs: z.number().int().min(1).max(3_600_000) })
  .strict();

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
    this.sender = new Sender(this.workspace, options.log);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  attach(socket: Socket): RpcPeer {
    const context: PeerContext = {
      mcpRoot: null,
      releaseAssistant: null,
      aborts: new AbortController(),
    };
    const peer: RpcPeer = new RpcPeer(
      socket,
      (method, params) => this.dispatch(context, method, params),
      this.options.log,
    );
    this.peers.add(peer);
    peer.onClose(() => {
      this.peers.delete(peer);
      context.releaseAssistant?.();
      context.aborts.abort();
    });
    return peer;
  }

  private async dispatch(context: PeerContext, method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "request": {
        const { action, params: inner } = parseInternal(requestParams, method, params);
        return this.request(action, inner);
      }
      case "mcp.hello":
        return this.hello(context, parseInternal(helloParams, method, params));
      case "listen.wait": {
        const { root, timeoutMs } = parseInternal(listenParams, method, params);
        const canonical = this.listenRoot(root);
        return this.workspace.broker(canonical).listen(timeoutMs, context.aborts.signal);
      }
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

  private listenRoot(root: string): string {
    let canonical: string;
    try {
      canonical = canonicalRoot(root);
    } catch (error) {
      throw badRequest(
        `The project root ${root} cannot be read: ${(error as Error).message}.`,
        "Run northstar listen from the project folder.",
      );
    }
    this.workspace.registry.rememberRoot(canonical);
    return canonical;
  }

  private hello(context: PeerContext, params: z.infer<typeof helloParams>): Record<string, never> {
    let root: string;
    try {
      root = canonicalRoot(params.root);
    } catch (error) {
      throw badRequest(
        `The project root ${params.root} cannot be read: ${(error as Error).message}.`,
        "Start the agent in an existing project directory.",
      );
    }
    allowLocalExtensions(this.options.home, this.options.log);
    context.releaseAssistant?.();
    context.releaseAssistant = this.workspace.registry.attachAssistant(root);
    context.mcpRoot = root;
    this.workspace.registry.rememberRoot(root);
    this.options.log(`mcp.hello root=${root}`);
    return {};
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
      case "project.list":
        parseParams("project.list", params);
        return this.workspace.projects();
      case "project.resolve":
        return this.workspace.resolveProject(parseParams("project.resolve", params));
      case "status.get":
        return this.comments.status(parseParams("status.get", params));
      case "handoff.send":
        return this.sender.send(parseParams("handoff.send", params));
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
      template: settings.template,
      projects: settings.projects,
    };
  }

  closeAll(): void {
    for (const peer of this.peers) peer.close();
  }
}
