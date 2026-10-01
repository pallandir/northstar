import { VERSION } from "../config.js";
import { connectDaemon } from "../daemon/client.js";
import { fileLogger } from "../daemon/log.js";
import { launchQuickRun } from "../daemon/quickrun.js";
import { RpcError } from "../daemon/rpc.js";
import { startDaemon } from "../daemon/server.js";
import { northstarHome } from "../lib/home.js";

async function stop(home: string): Promise<number> {
  try {
    const peer = await connectDaemon(() => {}, null, home);
    await peer.call("daemon.shutdown", {});
    peer.close();
    process.stdout.write("The Northstar daemon is stopping.\n");
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    process.stdout.write("The Northstar daemon is not running.\n");
  }
  return 0;
}

async function status(home: string): Promise<number> {
  try {
    const peer = await connectDaemon(() => {}, null, home);
    const info = await peer.call<{
      version: string;
      protocol: number;
      pid: number;
      startedAt: string;
    }>("request", { action: "system.info", params: {} });
    peer.close();
    process.stdout.write(
      `running, version ${info.version}, protocol ${info.protocol}, pid ${info.pid}, started ${info.startedAt}\n`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    process.stdout.write("not running, it starts on demand by northstar run\n");
    return 0;
  }
}

export async function daemonCommand(args: string[]): Promise<number> {
  const home = northstarHome();
  const [sub] = args;
  if (sub === "stop") return stop(home);
  if (sub === "status") return status(home);
  if (sub !== undefined) {
    process.stderr.write("Usage: northstar daemon [stop|status]\n");
    return 2;
  }
  const log = fileLogger(home);
  let running: Awaited<ReturnType<typeof startDaemon>>;
  try {
    running = await startDaemon({ home, version: VERSION, log, launchQuickRun });
  } catch (error) {
    const message = (error as Error).message;
    if (/already running/.test(message)) {
      process.stderr.write(`${message}\n`);
      return 0;
    }
    throw error;
  }
  if (process.stderr.isTTY) process.stderr.write(`northstar daemon listening on ${running.path}\n`);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => void running.close());
  }
  await running.closed;
  return 0;
}
