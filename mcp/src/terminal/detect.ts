import { ItermDriver } from "./drivers/iterm.js";
import { KittyDriver } from "./drivers/kitty.js";
import { TerminalAppDriver } from "./drivers/terminal-app.js";
import { TmuxDriver } from "./drivers/tmux.js";
import { WeztermDriver } from "./drivers/wezterm.js";
import type { TerminalDriver } from "./types.js";

export type Detection = { driver: TerminalDriver } | { driver: null; reason: string; fix: string };

const SUPPORTED_FIX =
  "Run the agent in tmux, WezTerm, kitty, iTerm2 or Terminal.app, or start it with northstar run.";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function detectDriver(env: NodeJS.ProcessEnv, tty: string | null): Detection {
  try {
    if (env.TMUX_PANE) return { driver: new TmuxDriver(env.TMUX_PANE) };
    if (env.WEZTERM_PANE) return { driver: new WeztermDriver(env.WEZTERM_PANE) };
    if (env.KITTY_WINDOW_ID) {
      if (!env.KITTY_LISTEN_ON) {
        return {
          driver: null,
          reason: "kitty remote control is not listening on a socket.",
          fix: "Set allow_remote_control socket-only and listen_on unix:/tmp/kitty in kitty.conf, then restart kitty.",
        };
      }
      return { driver: new KittyDriver(required(env, "KITTY_WINDOW_ID")) };
    }
    const program = env.TERM_PROGRAM;
    if (program === "iTerm.app" || program === "Apple_Terminal") {
      if (!tty) {
        return {
          driver: null,
          reason: "Northstar could not find the terminal of the agent process.",
          fix: SUPPORTED_FIX,
        };
      }
      return {
        driver: program === "iTerm.app" ? new ItermDriver(tty) : new TerminalAppDriver(tty),
      };
    }
  } catch (error) {
    return { driver: null, reason: `${(error as Error).message}.`, fix: SUPPORTED_FIX };
  }
  return {
    driver: null,
    reason: "Northstar can not find a terminal it can type into.",
    fix: SUPPORTED_FIX,
  };
}
