import type { HandoffCommand } from "./payload.js";

export type DriverName = "tmux" | "iterm" | "terminal-app" | "wezterm" | "kitty";

export interface TerminalDriver {
  readonly name: DriverName;
  capture(): Promise<string>;
  sendText(text: HandoffCommand): Promise<void>;
  sendEnter(): Promise<void>;
}
