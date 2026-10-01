import { exec } from "../exec.js";
import { type HandoffCommand, assertHandoffCommand } from "../payload.js";
import type { TerminalDriver } from "../types.js";

export const TMUX_PANE_ID = /^%\d+$/;

export class TmuxDriver implements TerminalDriver {
  readonly name = "tmux" as const;

  constructor(private readonly pane: string) {
    if (!TMUX_PANE_ID.test(pane)) throw new Error(`TMUX_PANE "${pane}" is not a pane id`);
  }

  async capture(): Promise<string> {
    return exec("tmux", ["capture-pane", "-p", "-t", this.pane]);
  }

  async sendText(text: HandoffCommand): Promise<void> {
    assertHandoffCommand(text);
    await exec("tmux", ["send-keys", "-t", this.pane, "-l", "--", text]);
  }

  async sendEnter(): Promise<void> {
    await exec("tmux", ["send-keys", "-t", this.pane, "Enter"]);
  }
}
