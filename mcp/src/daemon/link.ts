import type { DeferralNotice } from "@northstar/protocol";
import { ancestorPids } from "../pty/ancestors.js";
import { ensureDaemon } from "./client.js";
import type { RpcPeer } from "./rpc.js";

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
}

export class DaemonLink implements BrokerLink {
  private peer: RpcPeer | null = null;
  private connecting: Promise<RpcPeer | null> | null = null;
  private failedAt = 0;
  private current: BridgeStatus = { state: "off", error: "the daemon link has not started yet" };
  private ancestorList: number[] | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

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

  private async open(): Promise<RpcPeer | null> {
    const connect = this.options.connect ?? ensureDaemon;
    try {
      const peer = await connect(this.options.log, null, this.options.home);
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
      if (hello.session === null) {
        this.options.log(UNWRAPPED_AGENT);
      }
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
}

const UNWRAPPED_AGENT =
  "Northstar cannot type into this assistant, so Send to AI offers Copy the line in the toolbar instead.";
