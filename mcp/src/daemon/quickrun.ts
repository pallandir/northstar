import { PtySession } from "../pty/pty-session.js";
import type { QuickRunLauncher } from "./core.js";

const COLS = 120;
const ROWS = 40;

export const launchQuickRun: QuickRunLauncher = (spec) => {
  let exitCode: number | null = null;
  const listeners: Array<(code: number) => void> = [];
  const session = new PtySession({
    file: spec.file,
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    cols: COLS,
    rows: ROWS,
    onExit: (code) => {
      exitCode = code;
      for (const listener of listeners) listener(code);
    },
  });
  return {
    pid: session.pid,
    onExit: (listener) => {
      if (exitCode !== null) listener(exitCode);
      else listeners.push(listener);
    },
  };
};
