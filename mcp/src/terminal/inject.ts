import { COALESCE_MS, READY_POLL_MS, READY_TIMEOUT_MS, SUBMIT_DELAY_MS } from "../config.js";
import { detectTerminal } from "./detect.js";
import { HANDOFF_LINE } from "./payload.js";
import type { Handoff, HandoffResult, TerminalDriver, TerminalStatus } from "./types.js";

const TAIL_LINES = 20;
const CHOICE_PROMPT = /^\s*[❯>›]\s*\d+[.)]\s/;
const CONFIRM_PROMPT = /\((?:y\/n|yes\/no)\)|\[y\/n\]/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tail(screen: string): string {
  return screen
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-TAIL_LINES)
    .join("\n");
}

function awaitingAnswer(view: string): boolean {
  if (CONFIRM_PROMPT.test(view)) return true;
  return view.split("\n").some((line) => CHOICE_PROMPT.test(line));
}

async function waitForIdle(driver: TerminalDriver, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let previous: string | null = null;
  let blocked: string | null = null;

  while (Date.now() < deadline) {
    const view = tail(await driver.capture());
    if (awaitingAnswer(view)) {
      blocked = "the agent is waiting on a prompt, Northstar will not answer it for you";
      previous = null;
    } else if (previous !== null && view === previous) {
      return null;
    } else {
      blocked = null;
      previous = view;
    }
    await sleep(READY_POLL_MS);
  }
  return blocked ?? "the agent did not settle, its output never went quiet";
}

export class TerminalHandoff implements Handoff {
  private detection: ReturnType<typeof detectTerminal> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastTyped = 0;

  constructor(
    private readonly log: (msg: string) => void,
    private readonly readyTimeoutMs: number = READY_TIMEOUT_MS,
  ) {}

  async describe(): Promise<TerminalStatus> {
    this.detection ??= detectTerminal();
    const { driver, reason } = await this.detection;
    return driver ? { available: true, driver: driver.name } : { available: false, reason };
  }

  send(): Promise<HandoffResult> {
    const next = this.chain.then(() => this.run());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async run(): Promise<HandoffResult> {
    this.detection ??= detectTerminal();
    const { driver, reason } = await this.detection;
    if (!driver) {
      this.log(`handoff skipped: ${reason}`);
      return { typed: false, reason };
    }

    // One line covers every comment still open, so batches landing back to back are announced
    // once. That also stops anything on loopback from typing at the agent in a loop.
    if (Date.now() - this.lastTyped < COALESCE_MS) {
      return { typed: true, driver: driver.name, reason: "folded into the batch just announced" };
    }

    try {
      const blocked = await waitForIdle(driver, this.readyTimeoutMs);
      if (blocked) {
        this.log(`handoff skipped: ${blocked}`);
        return { typed: false, driver: driver.name, reason: blocked };
      }
      await driver.sendText(HANDOFF_LINE);
      // The Enter has to be its own write: an agent TUI folds a return that arrives inside the
      // same burst into the pasted text instead of submitting it.
      await sleep(SUBMIT_DELAY_MS);
      await driver.sendEnter();
      this.lastTyped = Date.now();
      this.log(`handoff typed into ${driver.name}`);
      return { typed: true, driver: driver.name };
    } catch (err) {
      const message = (err as Error).message;
      this.log(`handoff failed: ${message}`);
      return { typed: false, driver: driver.name, reason: message };
    }
  }
}
