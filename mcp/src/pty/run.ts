import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { templateLine, templateSchema } from "@northstar/protocol";
import { z } from "zod";
import { findExecutable, mergeAgents } from "../agents/definitions.js";
import { ensureDaemon } from "../daemon/client.js";
import { fileLogger } from "../daemon/log.js";
import { RpcError, type RpcHandler, type RpcPeer } from "../daemon/rpc.js";
import { northstarHome } from "../lib/home.js";
import { recordUserPath, userPath } from "../lib/user-path.js";
import { loadSettings } from "../user-config.js";
import { deliverLine } from "./deliver.js";
import { PtySession } from "./pty-session.js";

const ACTIVITY_THROTTLE_MS = 1_000;
const RECONNECT_MS = 2_000;
const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

export class RunError extends Error {}

interface Target {
  agent: string;
  file: string;
}

function resolveTarget(name: string, home: string): Target {
  const settings = loadSettings(home);
  const definition = mergeAgents(settings.agents).find((a) => a.id === name);
  const executable = definition?.executable ?? name;
  const file = findExecutable(executable, userPath(home));
  if (!file) {
    throw new RunError(
      `${definition?.name ?? name} was not found on the PATH. Install it, or pass the full path to its executable.`,
    );
  }
  return { agent: definition?.id ?? basename(file), file };
}

function runPlain(file: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

export async function runAgent(
  name: string,
  args: string[],
  home: string = northstarHome(),
): Promise<number> {
  const target = resolveTarget(name, home);
  if (process.env.NORTHSTAR_SESSION_ID) return runPlain(target.file, args);
  if (process.platform === "win32") {
    throw new RunError("northstar run supports macOS and Linux, Windows is not supported yet.");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new RunError("northstar run needs an interactive terminal on stdin and stdout.");
  }

  recordUserPath(home);
  const log = fileLogger(home);
  const id = randomUUID();
  let session: PtySession | null = null;

  const handler: RpcHandler = async (method, params) => {
    if (method !== "session.deliver") {
      throw new RpcError(
        "UNSUPPORTED_ACTION",
        `A session does not serve ${method}.`,
        "Update Northstar.",
      );
    }
    const { template } = z.object({ template: templateSchema }).strict().parse(params);
    if (!session) {
      throw new RpcError("SESSION_NOT_FOUND", "The agent has not started yet.", "Try again.");
    }
    return deliverLine(session, templateLine(template));
  };

  const register = async (): Promise<RpcPeer> => {
    const peer = await ensureDaemon(log, handler, home);
    await peer.call("session.register", {
      id,
      agent: target.agent,
      command: target.file,
      cwd: process.cwd(),
      pid: process.pid,
    });
    return peer;
  };

  let peer = await register();
  let exiting = false;
  let reconnecting = false;

  const watch = (current: RpcPeer): void => {
    current.onClose(() => {
      if (exiting || reconnecting) return;
      reconnecting = true;
      log(`session ${id} lost the daemon, reconnecting`);
      const retry = (): void => {
        if (exiting) return;
        register().then(
          (next) => {
            peer = next;
            reconnecting = false;
            log(`session ${id} registered again`);
            watch(next);
          },
          (error: Error) => {
            log(`session ${id} could not reconnect: ${error.message}`);
            setTimeout(retry, RECONNECT_MS).unref();
          },
        );
      };
      setTimeout(retry, RECONNECT_MS).unref();
    });
  };
  watch(peer);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.NORTHSTAR_SESSION_ID = id;
  env.PATH = userPath(home);

  let lastActivity = 0;
  const noteActivity = (): void => {
    const now = Date.now();
    if (now - lastActivity < ACTIVITY_THROTTLE_MS || peer.isClosed) return;
    lastActivity = now;
    peer.call("session.activity", { id }).catch((error: Error) => {
      log(`activity not reported: ${error.message}`);
    });
  };

  return new Promise<number>((resolve, reject) => {
    const restore = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    try {
      session = new PtySession({
        file: target.file,
        args,
        cwd: process.cwd(),
        env,
        cols: process.stdout.columns || FALLBACK_COLS,
        rows: process.stdout.rows || FALLBACK_ROWS,
        term: process.env.TERM,
        onOutput: (data) => {
          process.stdout.write(data);
          noteActivity();
        },
        onExit: (code) => {
          exiting = true;
          restore();
          peer.close();
          resolve(code);
        },
      });
    } catch (error) {
      exiting = true;
      peer.close();
      reject(error);
      return;
    }
    const active = session;
    process.stdin.setRawMode(true);
    process.once("exit", restore);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data: string) => active.userInput(data));
    process.stdin.resume();
    process.stdout.on("resize", () => {
      active.resize(process.stdout.columns || FALLBACK_COLS, process.stdout.rows || FALLBACK_ROWS);
    });
    for (const signal of ["SIGTERM", "SIGHUP"] as const) {
      process.on(signal, () => active.kill(signal));
    }
  });
}
