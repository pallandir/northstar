import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { type Socket, createConnection } from "node:net";
import { join } from "node:path";
import { logDir, northstarHome, socketPath } from "../lib/home.js";
import { RpcError, type RpcHandler, RpcPeer } from "./rpc.js";

const SPAWN_WAIT_MS = 5_000;
const SPAWN_POLL_MS = 100;

const unavailable = (detail: string): RpcError =>
  new RpcError(
    "DAEMON_UNAVAILABLE",
    `The Northstar daemon is not reachable, ${detail}.`,
    "Run northstar daemon in a terminal to see why it does not start, or run northstar doctor.",
  );

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      reject(unavailable(error.code ?? error.message));
    });
  });
}

export async function connectDaemon(
  log: (message: string) => void,
  handler: RpcHandler | null = null,
  home: string = northstarHome(),
): Promise<RpcPeer> {
  const socket = await connectSocket(socketPath(home));
  return new RpcPeer(socket, handler, log);
}

function spawnDaemonProcess(home: string = northstarHome()): void {
  const script = process.argv[1];
  if (!script) throw new Error("Northstar cannot tell which script to start as the daemon.");
  mkdirSync(logDir(home), { recursive: true, mode: 0o700 });
  const out = openSync(join(logDir(home), "daemon.out"), "a", 0o600);
  try {
    const child = spawn(process.execPath, [realpathSync(script), "daemon"], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, NORTHSTAR_HOME: home },
    });
    child.unref();
  } finally {
    closeSync(out);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureDaemon(
  log: (message: string) => void,
  handler: RpcHandler | null = null,
  home: string = northstarHome(),
  start: (home: string) => void = spawnDaemonProcess,
  waitMs: number = SPAWN_WAIT_MS,
): Promise<RpcPeer> {
  try {
    return await connectDaemon(log, handler, home);
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
  }
  start(home);
  const deadline = Date.now() + waitMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_MS);
    try {
      return await connectDaemon(log, handler, home);
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      last = error;
    }
  }
  throw new RpcError(
    "DAEMON_UNAVAILABLE",
    `The Northstar daemon did not start within ${waitMs / 1000} seconds${last ? ` (${(last as Error).message})` : ""}.`,
    `Run northstar daemon in a terminal to see why, or read ${join(logDir(home), "daemon.out")}.`,
  );
}
