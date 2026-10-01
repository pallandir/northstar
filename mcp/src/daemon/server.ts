import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { runtimeDir, socketPath } from "../lib/home.js";
import { connectDaemon } from "./client.js";
import { Daemon, type QuickRunLauncher } from "./core.js";
import { RpcError } from "./rpc.js";

const IDLE_CHECK_MS = 30_000;
const IDLE_EXIT_MS = 10 * 60 * 1000;

interface DaemonServerOptions {
  home: string;
  version: string;
  log: (message: string) => void;
  launchQuickRun: QuickRunLauncher;
  idleExitMs?: number;
  pickupTimeoutMs?: number;
}

export interface RunningDaemon {
  daemon: Daemon;
  path: string;
  closed: Promise<void>;
  close(): Promise<void>;
}

async function alreadyRunning(home: string, log: (message: string) => void): Promise<boolean> {
  try {
    (await connectDaemon(log, null, home)).close();
    return true;
  } catch (error) {
    if (error instanceof RpcError) return false;
    throw error;
  }
}

export async function startDaemon(options: DaemonServerOptions): Promise<RunningDaemon> {
  const { home, log } = options;
  const path = socketPath(home);
  mkdirSync(runtimeDir(home), { recursive: true, mode: 0o700 });
  chmodSync(runtimeDir(home), 0o700);

  let finish: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const daemon = new Daemon({
    home,
    version: options.version,
    log,
    launchQuickRun: options.launchQuickRun,
    pickupTimeoutMs: options.pickupTimeoutMs,
    onShutdown: () => void close(),
  });
  const server = createServer((socket) => {
    daemon.attach(socket);
  });
  const listen = () =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  try {
    await listen();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    if (await alreadyRunning(home, log)) {
      throw new Error(`A Northstar daemon is already running on ${path}.`);
    }
    rmSync(path, { force: true });
    await listen();
  }
  chmodSync(path, 0o600);

  let idleSince: number | null = null;
  const idleLimit = options.idleExitMs ?? IDLE_EXIT_MS;
  const timer = setInterval(() => {
    if (daemon.peerCount > 0) {
      idleSince = null;
      return;
    }
    idleSince ??= Date.now();
    if (Date.now() - idleSince >= idleLimit) {
      log("idle, exiting");
      void close();
    }
  }, IDLE_CHECK_MS);
  timer.unref();

  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    closing ??= (async () => {
      clearInterval(timer);
      daemon.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(path, { force: true });
      finish();
    })();
    return closing;
  }

  log(`daemon listening on ${path} version=${options.version} pid=${process.pid}`);
  return { daemon, path, closed, close };
}
