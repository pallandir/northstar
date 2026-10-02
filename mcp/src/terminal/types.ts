type DriverName = "tmux" | "iterm" | "terminal-app" | "wezterm" | "kitty";

export interface TerminalDriver {
  readonly name: DriverName;
  capture(): Promise<string>;
  sendText(text: string): Promise<void>;
  sendEnter(): Promise<void>;
}
