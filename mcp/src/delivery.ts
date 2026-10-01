import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AgentKind, AgentReadiness, DeliveryVia, HandoffOutcome } from "@northstar/protocol";
import type { Broker } from "./broker.js";
import { PICKUP_TIMEOUT_MS } from "./config.js";
import { RESOLVE_DIRECTIVE } from "./directive.js";
import { type AgentProcess, findAgent } from "./terminal/discover.js";
import type { TerminalTyper } from "./terminal/index.js";

export const CHANNEL_CAPABILITY = "claude/channel";
export const CHANNEL_METHOD = "notifications/claude/channel";

const CHANNEL_FLAGS = new Set(["--channels", "--dangerously-load-development-channels"]);
const NORTHSTAR_ENTRY = /^(?:server|plugin):northstar(?:@.+)?$/;
export const CLAUDE_CHANNEL_FIX =
  "Restart Claude Code with: claude --dangerously-load-development-channels server:northstar";

const AGENT_NAMES: Record<AgentKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  other: "The agent",
};

export function listensToNorthstar(command: string): boolean {
  const tokens = command.split(/\s+/);
  let inChannelList = false;
  for (const token of tokens) {
    const [flag, inline] = token.split("=", 2) as [string, string | undefined];
    if (CHANNEL_FLAGS.has(flag)) {
      inChannelList = true;
      if (inline !== undefined && NORTHSTAR_ENTRY.test(inline)) return true;
    } else if (token.startsWith("-")) {
      inChannelList = false;
    } else if (inChannelList && NORTHSTAR_ENTRY.test(token)) {
      return true;
    }
  }
  return false;
}

export interface Delivery {
  readiness(): Promise<AgentReadiness>;
  deliver(): Promise<HandoffOutcome>;
}

export interface AgentDeliveryOptions {
  server: Pick<Server, "notification">;
  broker: Broker;
  terminal: TerminalTyper;
  log: (msg: string) => void;
  openCount: () => Promise<number>;
  findAgent?: () => Promise<AgentProcess>;
  pickupTimeoutMs?: number;
}

export class AgentDelivery implements Delivery {
  private agent: Promise<AgentProcess> | null = null;

  constructor(private readonly options: AgentDeliveryOptions) {}

  private process(): Promise<AgentProcess> {
    if (!this.agent) {
      this.agent = (this.options.findAgent ?? findAgent)().catch((err: unknown) => {
        this.agent = null;
        throw err;
      });
    }
    return this.agent;
  }

  async readiness(): Promise<AgentReadiness> {
    const { kind, command } = await this.process();
    const name = AGENT_NAMES[kind];
    if (kind === "claude-code") {
      if (!listensToNorthstar(command)) {
        return {
          ready: false,
          agent: kind,
          via: "channel",
          reason: `${name} was started without the northstar channel, so Northstar can not wake it.`,
          fix: CLAUDE_CHANNEL_FIX,
        };
      }
      return { ready: true, agent: kind, via: "channel" };
    }
    if (kind === "other") {
      return {
        ready: false,
        agent: kind,
        via: null,
        reason: "Northstar can only wake Claude Code, Codex or Gemini CLI.",
        fix: "Start one of them in this project, so its MCP server is the one the page uses.",
      };
    }
    const check = await this.options.terminal.check();
    if (!check.ok) {
      return { ready: false, agent: kind, via: "terminal", reason: check.reason, fix: check.fix };
    }
    return { ready: true, agent: kind, via: "terminal", driver: check.driver };
  }

  async deliver(): Promise<HandoffOutcome> {
    const { broker, log } = this.options;
    const readiness = await this.readiness();
    const outcome = (fields: Pick<HandoffOutcome, "delivered" | "reason" | "fix">) => ({
      agent: readiness.agent,
      via: readiness.via,
      at: new Date().toISOString(),
      ...fields,
    });
    if (!readiness.ready) {
      return outcome({ delivered: false, reason: readiness.reason, fix: readiness.fix });
    }

    const sentAt = Date.now();
    const sent = await this.send(readiness.via as DeliveryVia);
    if (!sent.ok) {
      log(`handoff not sent: ${sent.reason}`);
      return outcome({ delivered: false, reason: sent.reason, fix: sent.fix });
    }

    const timeout = this.options.pickupTimeoutMs ?? PICKUP_TIMEOUT_MS;
    if (await broker.waitForPoll(sentAt, timeout)) {
      log(`handoff picked up by ${readiness.agent} via ${readiness.via}`);
      return outcome({ delivered: true });
    }
    const name = AGENT_NAMES[readiness.agent];
    log(`handoff not picked up within ${timeout}ms`);
    return outcome({
      delivered: false,
      reason: `${name} did not start on the comments within ${Math.round(timeout / 1000)} seconds.`,
      fix: `Check ${name} for a pending prompt or a running task, then click Send to AI again.`,
    });
  }

  private async send(
    via: DeliveryVia,
  ): Promise<{ ok: true } | { ok: false; reason: string; fix: string }> {
    if (via === "terminal") {
      const typed = await this.options.terminal.type();
      return typed.typed ? { ok: true } : { ok: false, reason: typed.reason, fix: typed.fix };
    }
    try {
      const open = await this.options.openCount();
      await this.options.server.notification({
        method: CHANNEL_METHOD,
        params: { content: RESOLVE_DIRECTIVE, meta: { count: String(open) } },
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: `The channel push failed, ${(err as Error).message}.`,
        fix: CLAUDE_CHANNEL_FIX,
      };
    }
  }
}
