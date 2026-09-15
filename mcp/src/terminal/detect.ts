import { findControllingTty } from "./discover.js";
import { ItermDriver } from "./drivers/iterm.js";
import { TerminalAppDriver } from "./drivers/terminal-app.js";
import { TmuxDriver } from "./drivers/tmux.js";
import type { DriverName, TerminalDriver } from "./types.js";

export interface Detection {
  driver: TerminalDriver | null;
  reason?: string;
}

function forced(): DriverName | "none" | null {
  const value = process.env.NORTHSTAR_TERMINAL?.trim().toLowerCase();
  if (!value) return null;
  if (value === "tmux" || value === "iterm" || value === "terminal-app" || value === "none") {
    return value;
  }
  return null;
}

function flavour(): DriverName | null {
  const override = forced();
  if (override) return override === "none" ? null : override;
  if (process.env.TMUX_PANE) return "tmux";
  const program = process.env.TERM_PROGRAM;
  if (program === "iTerm.app") return "iterm";
  if (program === "Apple_Terminal") return "terminal-app";
  return null;
}

export async function detectTerminal(): Promise<Detection> {
  if (process.env.NORTHSTAR_INJECT === "0") {
    return { driver: null, reason: "handoff disabled by NORTHSTAR_INJECT=0" };
  }
  if (forced() === "none") {
    return { driver: null, reason: "handoff disabled by NORTHSTAR_TERMINAL=none" };
  }

  const name = flavour();
  if (!name) {
    return {
      driver: null,
      reason:
        "no supported terminal detected, start your agent in tmux, iTerm2 or Terminal.app to enable the handoff",
    };
  }

  if (name === "tmux") {
    const pane = process.env.TMUX_PANE;
    if (!pane) return { driver: null, reason: "TMUX_PANE is not set" };
    return { driver: new TmuxDriver(pane) };
  }

  const tty = await findControllingTty();
  if (!tty) {
    return { driver: null, reason: "could not find the controlling terminal of the agent process" };
  }
  return { driver: name === "iterm" ? new ItermDriver(tty) : new TerminalAppDriver(tty) };
}
