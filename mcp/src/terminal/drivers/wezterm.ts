import { exec } from "../exec.js";
import { type HandoffCommand, assertHandoffCommand } from "../payload.js";
import type { TerminalDriver } from "../types.js";

export const WEZTERM_PANE_ID = /^\d+$/;

export class WeztermDriver implements TerminalDriver {
  readonly name = "wezterm" as const;

  constructor(private readonly pane: string) {
    if (!WEZTERM_PANE_ID.test(pane)) throw new Error(`WEZTERM_PANE "${pane}" is not a pane id`);
  }

  capture(): Promise<string> {
    return exec("wezterm", ["cli", "get-text", "--pane-id", this.pane]);
  }

  async sendText(text: HandoffCommand): Promise<void> {
    assertHandoffCommand(text);
    await exec("wezterm", ["cli", "send-text", "--pane-id", this.pane, "--no-paste", text]);
  }

  async sendEnter(): Promise<void> {
    await exec("wezterm", ["cli", "send-text", "--pane-id", this.pane, "--no-paste", "\r"]);
  }
}
