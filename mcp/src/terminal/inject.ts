import { COALESCE_MS, READY_POLL_MS, READY_TIMEOUT_MS, SUBMIT_DELAY_MS } from "../config.js";
import { type Detection, detectTerminal } from "./detect.js";
import { findAgentKind } from "./discover.js";
import { type AgentKind, handoffLine } from "./payload.js";
import type { Handoff, HandoffResult, TerminalDriver, TerminalStatus } from "./types.js";

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

type Readiness = { ready: true } | { ready: false; reason: string };

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
  };
}

export class TerminalHandoff implements Handoff {
  private detection: Detection | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastTyped = 0;

  constructor(
    private readonly log: (msg: string) => void,
    private readonly readyTimeoutMs: number = READY_TIMEOUT_MS,
    private readonly agentKind: () => Promise<AgentKind> = findAgentKind,
  ) {}

  private async detect(): Promise<Detection> {
    if (this.detection) return this.detection;
    const result = await detectTerminal();
    if (!result.transient) this.detection = result;
    return result;
  }

  async describe(): Promise<TerminalStatus> {
    const { driver, reason } = await this.detect();
    return driver ? { available: true, driver: driver.name } : { available: false, reason };
  }

  send(): Promise<HandoffResult> {
    const next = this.chain.then(() => this.run());
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async run(): Promise<HandoffResult> {
    const { driver, reason } = await this.detect();
    if (!driver) {
      this.log(`handoff skipped: ${reason}`);
      return { typed: false, reason };
    }

    if (Date.now() - this.lastTyped < COALESCE_MS) {
      return {
        typed: false,
        driver: driver.name,
        reason: "folded into the batch just announced",
      };
    }

    try {
      const readiness = await waitForIdle(driver, this.readyTimeoutMs);
      if (!readiness.ready) {
        this.log(`handoff skipped: ${readiness.reason}`);
        return { typed: false, driver: driver.name, reason: readiness.reason };
      }
      const agent = await this.agentKind();
      await driver.sendText(handoffLine(agent));
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
