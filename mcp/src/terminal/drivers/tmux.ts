import { exec } from "../exec.js";
import type { TerminalDriver } from "../types.js";

export class TmuxDriver implements TerminalDriver {
  readonly name = "tmux" as const;

  constructor(private readonly pane: string) {}

  async capture(): Promise<string> {
    return exec("tmux", ["capture-pane", "-p", "-t", this.pane]);
  }

  async sendText(text: string): Promise<void> {
    await exec("tmux", ["send-keys", "-t", this.pane, "-l", "--", text]);
  }

  async sendEnter(): Promise<void> {
    await exec("tmux", ["send-keys", "-t", this.pane, "Enter"]);
  }
}
