import { appleQuote, osascript } from "../exec.js";
import type { TerminalDriver } from "../types.js";

function script(tty: string, body: string): string {
  return `if application "Terminal" is running then
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is "${appleQuote(tty)}" then
          ${body}
        end if
      end repeat
    end repeat
  end tell
end if
return "notfound"`;
}

async function runOrThrow(tty: string, body: string): Promise<string> {
  let out: string;
  try {
    out = await osascript(script(tty, body));
  } catch (err) {
    throw new Error(
      `Terminal.app could not be scripted, grant Accessibility permission to your agent in System Settings > Privacy & Security (${(err as Error).message})`,
    );
  }
  if (out === "notfound") {
    throw new Error(`no Terminal.app tab is attached to ${tty}`);
  }
  return out;
}

export class TerminalAppDriver implements TerminalDriver {
  readonly name = "terminal-app" as const;

  constructor(private readonly tty: string) {}

  async capture(): Promise<string> {
    return runOrThrow(this.tty, 'return "ok:" & (get contents of t)');
  }

  // Terminal.app exposes no per-tab write, so the tab must be focused and driven through
  // System Events, which is why this driver alone needs Accessibility permission.
  async sendText(text: string): Promise<void> {
    await runOrThrow(
      this.tty,
      `set selected tab of w to t
          set index of w to 1
          activate
          tell application "System Events" to keystroke "${appleQuote(text)}"
          return "ok"`,
    );
  }

  async sendEnter(): Promise<void> {
    await runOrThrow(
      this.tty,
      `set selected tab of w to t
          tell application "System Events" to key code 36
          return "ok"`,
    );
  }
}
