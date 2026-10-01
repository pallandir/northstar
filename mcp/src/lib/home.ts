import { homedir } from "node:os";
import { join } from "node:path";

const MAX_SOCKET_PATH = 100;

export function northstarHome(): string {
  return process.env.NORTHSTAR_HOME ?? homedir();
}

export function stateRoot(home: string = northstarHome()): string {
  return join(home, ".northstar");
}

export function runtimeDir(home: string = northstarHome()): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg && process.env.NORTHSTAR_HOME === undefined) return join(xdg, "northstar");
  return join(stateRoot(home), "run");
}

export function socketPath(home: string = northstarHome()): string {
  const path = join(runtimeDir(home), "northstar.sock");
  if (path.length > MAX_SOCKET_PATH) {
    throw new Error(
      `The Northstar socket path ${path} is longer than ${MAX_SOCKET_PATH} characters, which Unix sockets do not allow. Set NORTHSTAR_HOME to a shorter directory.`,
    );
  }
  return path;
}

export const stateDir = (home?: string) => join(stateRoot(home), "state");
export const logDir = (home?: string) => join(stateRoot(home), "logs");
export const binDir = (home?: string) => join(stateRoot(home), "bin");
export const configPath = (home?: string) => join(stateRoot(home), "config.yaml");
