import type { TerminalStatus } from "@northstar/protocol";
export type DriverName = "tmux" | "iterm" | "terminal-app";

export interface TerminalDriver {
  readonly name: DriverName;
  capture(): Promise<string>;
  sendText(text: string): Promise<void>;
  sendEnter(): Promise<void>;
}

export type { TerminalStatus } from "@northstar/protocol";

export interface HandoffResult {
  typed: boolean;
  channel?: boolean;
  driver?: DriverName;
  reason?: string;
}

export interface Handoff {
  describe(): Promise<TerminalStatus>;
  send(): Promise<HandoffResult>;
}
