import { assertTemplateLine } from "@northstar/protocol";
import { runCommand as exec } from "../../pty/run-command.js";
import type { TerminalDriver } from "../types.js";

const KITTY_WINDOW_ID = /^\d+$/;

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

  async sendText(text: string): Promise<void> {
    assertTemplateLine(text);
    await exec("kitty", ["@", "send-text", "--match", this.match, "--", text]);
  }

  async sendEnter(): Promise<void> {
    await exec("kitty", ["@", "send-text", "--match", this.match, "--", "\\r"]);
  }
}
