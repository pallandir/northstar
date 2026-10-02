import { randomUUID } from "node:crypto";
import {
  type AgentInfo,
  type HandoffOutcome,
  type SessionInfo,
  type TemplateId,
  type actionParams,
  templateLine,
} from "@northstar/protocol";
import type { z } from "zod";
import {
  type AgentDefinition,
  describeAgents,
  findExecutable,
  mergeAgents,
  quickRunArgv,
} from "../agents/definitions.js";
import { userPath } from "../lib/user-path.js";
import type { DeliverOutcome } from "../pty/deliver.js";
import { loadSettings } from "../user-config.js";
import type { SessionHandle } from "./registry.js";
import { NO_SESSION_FIX, routeSend } from "./router.js";
import { RpcError, badRequest } from "./rpc.js";
import type { Workspace } from "./workspace.js";

const PICKUP_TIMEOUT_MS = 20_000;

export interface QuickRunSpec {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

interface QuickRunHandle {
  pid: number;
  onExit(callback: (code: number) => void): void;
}

export type QuickRunLauncher = (spec: QuickRunSpec) => QuickRunHandle;

interface SenderOptions {
  launchQuickRun: QuickRunLauncher;
  pickupTimeoutMs?: number;
}

type Params<K extends keyof typeof actionParams> = z.infer<(typeof actionParams)[K]>;

function sentence(text: string): string {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capital.endsWith(".") ? capital : `${capital}.`;
}

export class Sender {
  private readonly sending = new Set<string>();

  constructor(
    private readonly workspace: Workspace,
    private readonly options: SenderOptions,
    private readonly log: (message: string) => void,
  ) {}

  private get timeoutMs(): number {
    return this.options.pickupTimeoutMs ?? PICKUP_TIMEOUT_MS;
  }

  private begin(root: string): void {
    if (this.sending.has(root)) {
      throw new RpcError(
        "BLOCKED",
        "A send to the agent is already in progress.",
        "Wait for it to finish.",
      );
    }
  }

  private starter(preferred: string | null): AgentInfo | undefined {
    const agents = describeAgents(
      mergeAgents(loadSettings(this.workspace.home).agents),
      userPath(this.workspace.home),
    ).filter((a) => a.installed && a.quickRun);
    return agents.find((a) => a.id === preferred) ?? agents[0];
  }

  private async requireOpenComments(root: string): Promise<void> {
    if ((await this.workspace.store(root).list("open")).length === 0) {
      throw badRequest(
        "There are no open comments to send.",
        "Add a comment, then click Send to AI.",
      );
    }
  }

  async send(params: Params<"session.send">): Promise<HandoffOutcome> {
    const root = this.workspace.requireRoot(params.root);
    this.begin(root);
    await this.requireOpenComments(root);
    const settings = loadSettings(this.workspace.home);
    const registry = this.workspace.registry;
    const route = routeSend(registry.list(), {
      root,
      sessionId: params.sessionId,
      preferredAgent: settings.preferredAgent,
    });
    if (route.kind === "none") {
      const starter = this.starter(settings.preferredAgent);
      if (!starter) {
        throw new RpcError(
          "NO_SESSION",
          "No AI assistant is open in this project and Northstar found none it can start.",
          NO_SESSION_FIX,
        );
      }
      this.log(`session.send no session, starting ${starter.id}`);
      return this.quickRun({ root, agent: starter.id, template: params.template });
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
    const handle = registry.get(route.session.id) as SessionHandle;
    this.sending.add(root);
    try {
      const started = Date.now();
      const outcome = await this.deliver(handle, params.template);
      const handoff = await this.confirm(root, handle.info, outcome, started);
      this.workspace.broker(root).recordHandoff(handoff);
      this.log(
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
        this.workspace.registry.remove(handle.info.id);
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
    const timeout = this.timeoutMs;
    if (await this.workspace.broker(root).waitForPoll(sentAt, timeout)) {
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

  async quickRun(params: Params<"quickrun.execute">): Promise<HandoffOutcome> {
    const root = this.workspace.requireRoot(params.root);
    this.begin(root);
    const live = this.workspace.registry.list().filter((s) => s.root === root);
    if (live.length > 0) {
      throw new RpcError(
        "BLOCKED",
        "An agent session is already running in this project.",
        "Use Send to AI, quick run is only for projects with no session.",
      );
    }
    await this.requireOpenComments(root);
    const settings = loadSettings(this.workspace.home);
    const definition = mergeAgents(settings.agents).find((a) => a.id === params.agent);
    if (!definition) {
      throw badRequest(
        `Northstar does not know the agent ${params.agent}.`,
        "Pick one from the list.",
      );
    }
    const path = userPath(this.workspace.home);
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
    this.workspace.registry.add({
      info,
      deliver: async () => {
        throw new RpcError("BLOCKED", "A quick run takes no messages.", "Wait for it to finish.");
      },
    });
    const who = { id, agent: definition.id, name: definition.name };
    const exited = new Promise<number>((resolve) => handle.onExit(resolve));
    void exited.then((code) => {
      this.workspace.registry.remove(id);
      this.log(`quickrun.exited session=${id} agent=${definition.id} code=${code}`);
    });
    const timeout = this.timeoutMs;
    const winner = await Promise.race([
      this.workspace
        .broker(root)
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
    this.workspace.broker(root).recordHandoff(handoff);
    this.log(
      `quickrun.started session=${id} agent=${definition.id} delivered=${handoff.delivered}`,
    );
    return handoff;
  }
}
