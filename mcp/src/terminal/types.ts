export type DriverName = "tmux" | "iterm" | "terminal-app";

export interface TerminalDriver {
  readonly name: DriverName;
  capture(): Promise<string>;
  sendText(text: string): Promise<void>;
  sendEnter(): Promise<void>;
}

export interface TerminalStatus {
  available: boolean;
  driver?: string;
  reason?: string;
}

export interface HandoffResult {
  typed: boolean;
  driver?: DriverName;
  reason?: string;
}

export interface Handoff {
  describe(): Promise<TerminalStatus>;
  send(): Promise<HandoffResult>;
}
