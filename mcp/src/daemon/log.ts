import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { logDir } from "../lib/home.js";

const MAX_LOG_BYTES = 1024 * 1024;

export function fileLogger(home: string): (message: string) => void {
  const dir = logDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "northstar.log");
  return (message) => {
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.1`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  };
}
