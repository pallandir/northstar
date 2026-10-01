import { exec } from "../exec.js";
import { type HandoffCommand, assertHandoffCommand } from "../payload.js";
import type { TerminalDriver } from "../types.js";

export const KITTY_WINDOW_ID = /^\d+$/;

export class KittyDriver implements TerminalDriver {
  readonly name = "kitty" as const;
  private readonly match: string;

  constructor(windowId: string) {
    if (!KITTY_WINDOW_ID.test(windowId)) {
      throw new Error(`KITTY_WINDOW_ID "${windowId}" is not a window id`);
    }
    this.match = `id:${windowId}`;
  }

  capture(): Promise<string> {
    return exec("kitty", ["@", "get-text", "--match", this.match]);
  }

  async sendText(text: HandoffCommand): Promise<void> {
    assertHandoffCommand(text);
    await exec("kitty", ["@", "send-text", "--match", this.match, "--", text]);
  }

  async sendEnter(): Promise<void> {
    await exec("kitty", ["@", "send-text", "--match", this.match, "--", "\\r"]);
  }
}
