import type { BlockedReason } from "@northstar/protocol";
import { assertTemplateLine } from "@northstar/protocol";
import { awaitingAnswer, tail, typedInput } from "./screen-state.js";

export interface DeliveryTarget {
  lines(): string[] | Promise<string[]>;
  lastOutputAt(): number;
  lastUserInputAt(): number;
  write(data: string): void | Promise<void>;
  holdUserInput(hold: boolean): void;
}

export interface DeliveryTimings {
  pollMs: number;
  quietMs: number;
  userQuietMs: number;
  settleCapMs: number;
  submitQuietMs: number;
  submitCapMs: number;
}

const DELIVERY_TIMINGS: DeliveryTimings = {
  pollMs: 100,
  quietMs: 500,
  userQuietMs: 1500,
  settleCapMs: 10_000,
  submitQuietMs: 200,
  submitCapMs: 2_000,
};

export type DeliverOutcome =
  | { delivered: true }
  | { delivered: false; blocked: BlockedReason; reason: string; fix: string };

const BLOCKS: Record<BlockedReason, { reason: string; fix: string }> = {
  prompt: {
    reason: "the agent is waiting on a prompt, Northstar will not answer it for you",
    fix: "Answer the prompt in the agent, then click Send to AI again.",
  },
  input: {
    reason: "there is text in the agent input or you are typing, Northstar will not write over it",
    fix: "Send or clear the text in the agent input, then click Send to AI again.",
  },
  busy: {
    reason: "the agent did not settle, its output never went quiet",
    fix: "Wait for the agent to finish, then click Send to AI again.",
  },
};

function blocked(reason: BlockedReason): DeliverOutcome {
  return { delivered: false, blocked: reason, ...BLOCKS[reason] };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function deliverLine(
  target: DeliveryTarget,
  line: string,
  timings: DeliveryTimings = DELIVERY_TIMINGS,
): Promise<DeliverOutcome> {
  assertTemplateLine(line);

  let last: BlockedReason = "busy";
  const settleBy = Date.now() + timings.settleCapMs;
  for (;;) {
    const screen = tail(await target.lines());
    const now = Date.now();
    const quiet = now - target.lastOutputAt() >= timings.quietMs;
    const userIdle = now - target.lastUserInputAt() >= timings.userQuietMs;
    if (awaitingAnswer(screen)) {
      last = "prompt";
    } else if (quiet && userIdle) {
      if (typedInput(screen)) return blocked("input");
      break;
    } else {
      last = userIdle ? "busy" : "input";
    }
    if (now >= settleBy) return blocked(last);
    await sleep(timings.pollMs);
  }

  target.holdUserInput(true);
  try {
    await target.write(line);
    const submitBy = Date.now() + timings.submitCapMs;
    do {
      await sleep(timings.pollMs);
    } while (Date.now() - target.lastOutputAt() < timings.submitQuietMs && Date.now() < submitBy);
    await target.write("\r");
  } finally {
    target.holdUserInput(false);
  }
  return { delivered: true };
}
