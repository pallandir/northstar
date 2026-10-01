import { READY_POLL_MS, READY_TIMEOUT_MS, SUBMIT_DELAY_MS } from "../config.js";
import { type Detection, detectTerminal } from "./detect.js";
import { HANDOFF_COMMAND } from "./payload.js";
import type { TerminalDriver } from "./types.js";

const TAIL_LINES = 20;
const CHOICE_OPTION = /^\s*([❯>›])?\s*\d+[.)]\s/;
const CONFIRM_PROMPT = /\((?:y\/n|yes\/no)\)|\[y\/n\]/i;
const INPUT_LINE = /^[\s│|┃]*[❯>›]\s?(.*?)[\s│|┃]*$/;
const INPUT_PLACEHOLDER = /^(try "|ask |type |send a message|plan, search)/i;
const INPUT_SCAN_LINES = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tail(screen: string): string[] {
  return screen
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-TAIL_LINES);
}

export function awaitingAnswer(lines: string[]): boolean {
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  if (CONFIRM_PROMPT.test(last)) return true;
  let selected = false;
  let options = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = CHOICE_OPTION.exec(lines[i] as string);
    if (!match) break;
    options += 1;
    if (match[1]) selected = true;
  }
  return options > 0 && selected;
}

export function typedInput(lines: string[]): string | null {
  for (const line of lines.slice(-INPUT_SCAN_LINES).reverse()) {
    const match = INPUT_LINE.exec(line);
    if (!match) continue;
    const content = (match[1] ?? "").trim();
    return INPUT_PLACEHOLDER.test(content) ? "" : content;
  }
  return null;
}

type Readiness = { ready: true } | { ready: false; reason: string; fix: string };

async function waitForIdle(driver: TerminalDriver, timeoutMs: number): Promise<Readiness> {
  const deadline = Date.now() + timeoutMs;
  let previous: string | null = null;
  let blocked: string | null = null;

  while (Date.now() < deadline) {
    const lines = tail(await driver.capture());
    const view = lines.join("\n");
    if (awaitingAnswer(lines)) {
      blocked = "the agent is waiting on a prompt, Northstar will not answer it for you";
      previous = null;
    } else if (previous !== null && view === previous) {
      if (typedInput(lines)) {
        return {
          ready: false,
          reason: "there is text in the agent input, Northstar will not type over it",
          fix: "Send or clear the text in the agent input, then click Send to AI again.",
        };
      }
      return { ready: true };
    } else {
      blocked = null;
      previous = view;
    }
    await sleep(READY_POLL_MS);
  }
  return {
    ready: false,
    reason: blocked ?? "the agent did not settle, its output never went quiet",
    fix: blocked
      ? "Answer the prompt in the agent, then click Send to AI again."
      : "Wait for the agent to finish, then click Send to AI again.",
  };
}

export type TypeResult = { typed: true } | { typed: false; reason: string; fix: string };

export type TerminalCheck =
  | { ok: true; driver: string }
  | { ok: false; reason: string; fix: string };

const PROBE_TTL_MS = 5_000;

export class TerminalTyper {
  private detection: Detection | null = null;
  private probed: { at: number; check: TerminalCheck } | null = null;

  constructor(
    private readonly log: (msg: string) => void,
    private readonly readyTimeoutMs: number = READY_TIMEOUT_MS,
  ) {}

  private async detect(): Promise<Detection> {
    if (this.detection) return this.detection;
    const result = await detectTerminal();
    if (!result.transient) this.detection = result;
    return result;
  }

  async check(): Promise<TerminalCheck> {
    const { driver, reason, fix } = await this.detect();
    if (!driver) {
      return {
        ok: false,
        reason: reason ?? "No terminal is attached.",
        fix: fix ?? "Run the agent inside tmux.",
      };
    }
    if (this.probed && Date.now() - this.probed.at < PROBE_TTL_MS) return this.probed.check;
    let check: TerminalCheck;
    try {
      await driver.capture();
      check = { ok: true, driver: driver.name };
    } catch (err) {
      check = {
        ok: false,
        reason: `Northstar can not read the ${driver.name} session, ${(err as Error).message}.`,
        fix: PERMISSION_FIX[driver.name],
      };
    }
    this.probed = { at: Date.now(), check };
    return check;
  }

  async type(): Promise<TypeResult> {
    const { driver, reason, fix } = await this.detect();
    if (!driver) {
      return {
        typed: false,
        reason: reason ?? "No terminal is attached.",
        fix: fix ?? "Run the agent inside tmux.",
      };
    }
    try {
      const readiness = await waitForIdle(driver, this.readyTimeoutMs);
      if (!readiness.ready) {
        return { typed: false, reason: `${readiness.reason}.`, fix: readiness.fix };
      }
      await driver.sendText(HANDOFF_COMMAND);
      await sleep(SUBMIT_DELAY_MS);
      await driver.sendEnter();
      this.log(`handoff typed into ${driver.name}`);
      return { typed: true };
    } catch (err) {
      const message = (err as Error).message;
      this.log(`handoff failed: ${message}`);
      return {
        typed: false,
        reason: `Typing into ${driver.name} failed, ${message}.`,
        fix: PERMISSION_FIX[driver.name],
      };
    }
  }
}

const PERMISSION_FIX: Record<TerminalDriver["name"], string> = {
  tmux: "Check that the tmux pane still exists.",
  wezterm: "Check that the WezTerm pane still exists.",
  kitty: "Check that kitty has remote control enabled and the window still exists.",
  iterm: "Allow your agent to control iTerm2 in System Settings, Privacy & Security, Automation.",
  "terminal-app":
    "Allow your agent to control Terminal in System Settings, Privacy & Security, Accessibility.",
};
