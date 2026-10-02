import { assertTemplateLine } from "@northstar/protocol";
import { runCommand as exec } from "../../pty/run-command.js";
import type { TerminalDriver } from "../types.js";

const TMUX_PANE_ID = /^%\d+$/;

export class TmuxDriver implements TerminalDriver {
  readonly name = "tmux" as const;

  constructor(private readonly pane: string) {
    if (!TMUX_PANE_ID.test(pane)) throw new Error(`TMUX_PANE "${pane}" is not a pane id`);
  }

  async capture(): Promise<string> {
    return exec("tmux", ["capture-pane", "-p", "-t", this.pane]);
  }

  async sendText(text: string): Promise<void> {
    assertTemplateLine(text);
    await exec("tmux", ["send-keys", "-t", this.pane, "-l", "--", text]);
  }

  async sendEnter(): Promise<void> {
    await exec("tmux", ["send-keys", "-t", this.pane, "Enter"]);
  }
}
