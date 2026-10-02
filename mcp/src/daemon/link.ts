import { type DeferralNotice, templateLine, templateSchema } from "@northstar/protocol";
import { z } from "zod";
import { mergeAgents } from "../agents/definitions.js";
import { northstarHome } from "../lib/home.js";
import { ancestorPids } from "../pty/ancestors.js";
import { type DeliverOutcome, deliverLine } from "../pty/deliver.js";
import { type Detection, detectDriver } from "../terminal/detect.js";
import { type AgentProcess, findAgentProcess } from "../terminal/process.js";
import { TerminalTarget } from "../terminal/target.js";
import { loadSettings } from "../user-config.js";
import { ensureDaemon } from "./client.js";
import { RpcError, type RpcHandler, type RpcPeer } from "./rpc.js";

const RETRY_MS = 5_000;

export interface BrokerLink {
  polled(): void;
  bump(): void;
  notice(notice: DeferralNotice): void;
}

export type BridgeStatus = { state: "on" } | { state: "off"; error: string };

interface DaemonLinkOptions {
  root: string;
  home?: string;
  log: (message: string) => void;
  connect?: typeof ensureDaemon;
  ancestors?: () => Promise<number[]>;
  findAgent?: (executables: readonly string[]) => Promise<AgentProcess | null>;
  detect?: (tty: string | null) => Detection;
}

export class DaemonLink implements BrokerLink {
  private peer: RpcPeer | null = null;
  private connecting: Promise<RpcPeer | null> | null = null;
  private failedAt = 0;
  private current: BridgeStatus = { state: "off", error: "the daemon link has not started yet" };
  private ancestorList: number[] | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private driver: Detection | null = null;

  constructor(private readonly options: DaemonLinkOptions) {}

  status(): BridgeStatus {
    return this.current;
  }

  async start(): Promise<BridgeStatus> {
    await this.ensure();
    return this.current;
  }

  polled(): void {
    this.fire("broker.polled", {});
  }

  bump(): void {
    this.fire("broker.bump", {});
  }

  notice(notice: DeferralNotice): void {
    this.fire("broker.notice", notice);
  }

  private fire(method: string, params: unknown): void {
    void this.ensure()
      .then((peer) => peer?.call(method, params))
      .catch((error: Error) => this.options.log(`${method} was not delivered: ${error.message}`));
  }

  private ensure(): Promise<RpcPeer | null> {
    if (this.peer && !this.peer.isClosed) return Promise.resolve(this.peer);
    if (Date.now() - this.failedAt < RETRY_MS) return Promise.resolve(null);
    this.connecting ??= this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensure().then((peer) => {
        if (!peer) this.scheduleReconnect();
      });
    }, RETRY_MS);
    this.reconnectTimer.unref();
  }

  private readonly serve: RpcHandler = async (method, params) => {
    if (method !== "session.deliver") {
      throw new RpcError(
        "UNSUPPORTED_ACTION",
        `This agent connection does not serve ${method}.`,
        "Update Northstar.",
      );
    }
    const { template } = z.object({ template: templateSchema }).strict().parse(params);
    return this.deliver(templateLine(template));
  };

  private async deliver(line: string): Promise<DeliverOutcome> {
    const detection = this.driver;
    if (!detection?.driver) {
      throw new RpcError(
        "BLOCKED",
        detection?.reason ?? "Northstar has no terminal to type into for this agent.",
        detection?.fix ?? "Start the agent in a supported terminal.",
      );
    }
    try {
      return await deliverLine(new TerminalTarget(detection.driver), line);
    } catch (error) {
      this.options.log(`terminal delivery failed: ${(error as Error).message}`);
      throw new RpcError(
        "BLOCKED",
        `Typing into ${detection.driver.name} failed, ${(error as Error).message}.`,
        PERMISSION_FIX[detection.driver.name],
      );
    }
  }

  private async open(): Promise<RpcPeer | null> {
    const connect = this.options.connect ?? ensureDaemon;
    try {
      const peer = await connect(this.options.log, this.serve, this.options.home);
      this.ancestorList ??= await (this.options.ancestors ?? (() => ancestorPids()))();
      const hello = await peer.call<{ session: string | null }>("mcp.hello", {
        root: this.options.root,
        ancestors: this.ancestorList,
      });
      peer.onClose(() => {
        this.current = { state: "off", error: "the Northstar daemon closed the connection" };
        this.scheduleReconnect();
      });
      this.peer = peer;
      this.current = { state: "on" };
      if (hello.session === null) await this.registerTerminalSession(peer);
      return peer;
    } catch (error) {
      this.failedAt = Date.now();
      const message = (error as Error).message;
      if (this.current.state === "on" || this.current.error !== message) {
        this.options.log(`Send to AI is unavailable, ${message}`);
      }
      this.current = { state: "off", error: message };
      this.scheduleReconnect();
      return null;
    }
  }

  private async registerTerminalSession(peer: RpcPeer): Promise<void> {
    const home = this.options.home ?? northstarHome();
    const executables = mergeAgents(loadSettings(home).agents).map((a) => a.executable);
    const agent = await (this.options.findAgent ?? findAgentProcess)(executables);
    if (!agent) {
      this.options.log(
        "no known agent runs this Northstar server, so Send to AI has no session to write to. Add the agent with northstar agent add.",
      );
      return;
    }
    const definition = mergeAgents(loadSettings(home).agents).find(
      (a) => a.executable === agent.executable || a.executable.endsWith(`/${agent.executable}`),
    );
    this.driver = (this.options.detect ?? ((tty) => detectDriver(process.env, tty)))(agent.tty);
    if (!this.driver.driver) {
      this.options.log(`Send to AI cannot type into ${agent.executable}: ${this.driver.reason}`);
    }
    await peer.call("session.register", {
      agent: definition?.id ?? agent.executable,
      command: agent.command,
      cwd: this.options.root,
      pid: agent.pid,
      kind: "terminal",
    });
  }
}

const PERMISSION_FIX = {
  tmux: "Check that the tmux pane still exists.",
  wezterm: "Check that the WezTerm pane still exists.",
  kitty: "Check that kitty has remote control enabled and the window still exists.",
  iterm: "Allow your agent to control iTerm2 in System Settings, Privacy & Security, Automation.",
  "terminal-app":
    "Allow your agent to control Terminal in System Settings, Privacy & Security, Accessibility.",
} as const;
