import { assertTemplateLine } from "@northstar/protocol";
import { appleQuote, osascript } from "../osascript.js";
import type { TerminalDriver } from "../types.js";

export const TTY_PATH = /^\/dev\/(?:ttys\d+|pts\/\d+)$/;

function script(tty: string, body: string): string {
  return `if application "iTerm2" is running then
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is "${appleQuote(tty)}" then
            ${body}
          end if
        end repeat
      end repeat
    end repeat
  end tell
end if
return "notfound"`;
}

async function runOrThrow(tty: string, body: string): Promise<string> {
  const out = await osascript(script(tty, body));
  if (out === "notfound") {
    throw new Error(`no iTerm2 session is attached to ${tty}`);
  }
  return out;
}

export class ItermDriver implements TerminalDriver {
  readonly name = "iterm" as const;

  constructor(private readonly tty: string) {
    if (!TTY_PATH.test(tty)) throw new Error(`"${tty}" is not a terminal device`);
  }

  async capture(): Promise<string> {
    return (await runOrThrow(this.tty, 'return "ok:" & (get text of s)')).slice(3);
  }

  async sendText(text: string): Promise<void> {
    assertTemplateLine(text);
    await runOrThrow(
      this.tty,
      `tell s to write text "${appleQuote(text)}" newline NO
            return "ok"`,
    );
  }

  async sendEnter(): Promise<void> {
    await runOrThrow(
      this.tty,
      `tell s to write text "" newline YES
            return "ok"`,
    );
  }
}
