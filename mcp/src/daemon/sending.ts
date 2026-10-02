import type { HandoffOutcome, SessionInfo, TemplateId, actionParams } from "@northstar/protocol";
import type { z } from "zod";
import type { DeliverOutcome } from "../pty/deliver.js";
import { loadSettings } from "../user-config.js";
import type { SessionHandle } from "./registry.js";
import { noSessionNotice, routeSend } from "./router.js";
import { RpcError, badRequest } from "./rpc.js";
import type { Workspace } from "./workspace.js";

const PICKUP_TIMEOUT_MS = 20_000;

interface SenderOptions {
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
      assistantConnected: registry.hasAssistant(root),
    });
    if (route.kind === "none") {
      const { reason, fix } = noSessionNotice(registry.hasAssistant(root));
      throw new RpcError("NO_SESSION", reason, fix);
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
}
