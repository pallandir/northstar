import { findControllingTty } from "./discover.js";
import { ItermDriver } from "./drivers/iterm.js";
import { KittyDriver } from "./drivers/kitty.js";
import { TerminalAppDriver } from "./drivers/terminal-app.js";
import { TmuxDriver } from "./drivers/tmux.js";
import { WeztermDriver } from "./drivers/wezterm.js";
import type { DriverName, TerminalDriver } from "./types.js";

export interface Detection {
  driver: TerminalDriver | null;
  reason?: string;
  fix?: string;
  transient?: boolean;
}

const SUPPORTED_FIX = "Run the agent inside tmux, WezTerm, kitty, iTerm2 or Terminal.app.";

const DRIVER_NAMES: readonly string[] = ["tmux", "iterm", "terminal-app", "wezterm", "kitty"];

function forced(): DriverName | "none" | null {
  const value = process.env.NORTHSTAR_TERMINAL?.trim().toLowerCase();
  if (!value) return null;
  if (value === "none" || DRIVER_NAMES.includes(value)) return value as DriverName | "none";
  return null;
}

function flavour(): DriverName | null {
  const override = forced();
  if (override) return override === "none" ? null : override;
  if (process.env.TMUX_PANE) return "tmux";
  if (process.env.WEZTERM_PANE) return "wezterm";
  if (process.env.KITTY_WINDOW_ID) return "kitty";
  const program = process.env.TERM_PROGRAM;
  if (program === "iTerm.app") return "iterm";
  if (program === "Apple_Terminal") return "terminal-app";
  return null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function detectTerminal(): Promise<Detection> {
  if (process.env.NORTHSTAR_INJECT === "0") {
    return { driver: null, reason: "Handoff is disabled by NORTHSTAR_INJECT=0.", fix: "Unset it." };
  }
  if (forced() === "none") {
    return {
      driver: null,
      reason: "Handoff is disabled by NORTHSTAR_TERMINAL=none.",
      fix: "Unset it.",
    };
  }

  const name = flavour();
  if (!name) {
    return {
      driver: null,
      reason: "Northstar can not find a terminal it can type into.",
      fix: SUPPORTED_FIX,
    };
  }

  try {
    if (name === "tmux") return { driver: new TmuxDriver(required("TMUX_PANE")) };
    if (name === "wezterm") return { driver: new WeztermDriver(required("WEZTERM_PANE")) };
    if (name === "kitty") {
      if (!process.env.KITTY_LISTEN_ON) {
        return {
          driver: null,
          reason: "kitty remote control is not listening on a socket.",
          fix: "Set allow_remote_control socket-only and listen_on unix:/tmp/kitty in kitty.conf, then restart kitty.",
        };
      }
      return { driver: new KittyDriver(required("KITTY_WINDOW_ID")) };
    }
  } catch (error) {
    return { driver: null, reason: `${(error as Error).message}.`, fix: SUPPORTED_FIX };
  }

  let tty: string | null;
  try {
    tty = await findControllingTty();
  } catch (error) {
    return {
      driver: null,
      reason: `Northstar could not read the process list: ${(error as Error).message}.`,
      fix: "Retry in a moment.",
      transient: true,
    };
  }
  if (!tty) {
    return {
      driver: null,
      reason: "Northstar could not find the terminal of the agent process.",
      fix: SUPPORTED_FIX,
    };
  }
  try {
    return { driver: name === "iterm" ? new ItermDriver(tty) : new TerminalAppDriver(tty) };
  } catch (error) {
    return { driver: null, reason: `${(error as Error).message}.`, fix: SUPPORTED_FIX };
  }
}
