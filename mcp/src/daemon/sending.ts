import type { HandoffOutcome, TemplateId, actionParams } from "@northstar/protocol";
import type { z } from "zod";
import { notListeningNotice } from "./readiness.js";
import { RpcError, badRequest } from "./rpc.js";
import type { Workspace } from "./workspace.js";

export const ASSISTANT_ACTIVE_MS = 5 * 60 * 1000;

type Params<K extends keyof typeof actionParams> = z.infer<(typeof actionParams)[K]>;

export class Sender {
  private readonly sending = new Set<string>();

  constructor(
    private readonly workspace: Workspace,
    private readonly log: (message: string) => void,
  ) {}

  private begin(root: string): void {
    if (this.sending.has(root)) {
      throw new RpcError(
        "BLOCKED",
        "A send to the agent is already in progress.",
        "Wait for it to finish.",
      );
    }
    this.sending.add(root);
  }

  async send(params: Params<"handoff.send">): Promise<HandoffOutcome> {
    const root = this.workspace.requireRoot(params.root);
    this.begin(root);
    try {
      return await this.hand(root, params.template);
    } finally {
      this.sending.delete(root);
    }
  }

  private async hand(root: string, template: TemplateId): Promise<HandoffOutcome> {
    if ((await this.workspace.store(root).list("open")).length === 0) {
      throw badRequest(
        "There are no open comments to send.",
        "Add a comment, then click Send to AI.",
      );
    }
    const broker = this.workspace.broker(root);
    if (!broker.listenerSeenWithin(ASSISTANT_ACTIVE_MS)) {
      const { reason, fix } = notListeningNotice({
        connected: this.workspace.registry.hasAssistant(root),
        working: broker.activeWithin(ASSISTANT_ACTIVE_MS),
      });
      throw new RpcError("NOT_LISTENING", reason, fix);
    }
    const signal = broker.signalHandoff(template);
    const at = new Date().toISOString();
    const handoff: HandoffOutcome =
      signal === "woken"
        ? { delivered: true, at }
        : {
            delivered: false,
            blocked: "busy",
            reason:
              signal === "queued"
                ? "Your assistant is busy. The comments are saved and queued, it picks them up when it runs northstar listen again."
                : "Your assistant already has this batch and is working on it.",
            fix:
              signal === "queued"
                ? "If it stopped listening, click Copy the line and paste it again."
                : "Wait for it to finish, then click Send to AI again if you added comments.",
            at,
          };
    broker.recordHandoff(handoff);
    this.log(`handoff.send delivered=${handoff.delivered}`);
    return handoff;
  }
}
