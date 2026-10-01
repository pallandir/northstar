import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Broker } from "./broker.js";
import { RESOLVE_DIRECTIVE } from "./directive.js";
import type { CommentStore } from "./store.js";
import type { Handoff, HandoffResult, TerminalStatus } from "./terminal/index.js";

export const CHANNEL_CAPABILITY = "claude/channel";
export const CHANNEL_METHOD = "notifications/claude/channel";
const FALLBACK_MS = 8_000;

export interface ChannelHandoffOptions {
  server: Pick<Server, "notification" | "getClientCapabilities" | "getClientVersion">;
  store: CommentStore;
  broker: Broker;
  terminal: Handoff;
  log: (msg: string) => void;
  fallbackMs?: number;
}

export class ChannelHandoff implements Handoff {
  private timer: NodeJS.Timeout | null = null;
  private pushedAt = 0;
  private readonly fallbackMs: number;

  constructor(private readonly options: ChannelHandoffOptions) {
    this.fallbackMs = options.fallbackMs ?? FALLBACK_MS;
  }

  describe(): Promise<TerminalStatus> {
    return this.options.terminal.describe();
  }

  async send(): Promise<HandoffResult> {
    const { store, broker, terminal, log } = this.options;
    const open = await store.list("open");
    if (open.length === 0) return { typed: false, reason: "no open comments" };

    if (!this.channelSupported()) return terminal.send();

    if (this.timer && broker.lastPolledMs < this.pushedAt) {
      return { typed: false, channel: true, reason: "folded into the push just sent" };
    }

    try {
      this.pushedAt = Date.now();
      await this.options.server.notification({
        method: CHANNEL_METHOD,
        params: { content: RESOLVE_DIRECTIVE, meta: { count: String(open.length) } },
      });
    } catch (err) {
      log(`channel push failed: ${(err as Error).message}`);
      return terminal.send();
    }

    this.arm();
    log(`channel push sent for ${open.length} comment(s)`);
    return {
      typed: false,
      channel: true,
      reason: `pushed to the agent channel, typed fallback in ${Math.round(this.fallbackMs / 1000)}s if unanswered`,
    };
  }

  private channelSupported(): boolean {
    const { server } = this.options;
    if (server.getClientCapabilities()?.experimental?.[CHANNEL_CAPABILITY]) return true;
    return server.getClientVersion()?.name === "claude-code";
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    const pushedAt = this.pushedAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fallback(pushedAt);
    }, this.fallbackMs);
    this.timer.unref();
  }

  private async fallback(pushedAt: number): Promise<void> {
    const { store, broker, terminal, log } = this.options;
    if (broker.lastPolledMs >= pushedAt) return;
    if ((await store.list("open")).length === 0) return;
    log("no agent call after the channel push, typing into the terminal");
    try {
      await terminal.send();
    } catch (err) {
      log(`typed fallback failed: ${(err as Error).message}`);
    }
  }
}
