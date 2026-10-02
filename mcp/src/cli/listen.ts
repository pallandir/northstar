import { type TemplateId, templateLine } from "@northstar/protocol";
import { ensureDaemon } from "../daemon/client.js";
import { fileLogger } from "../daemon/log.js";
import { RpcError } from "../daemon/rpc.js";
import { northstarHome } from "../lib/home.js";
import { summarize } from "../render.js";
import { CommentStore } from "../store.js";

const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_SECONDS = 3600;

function parseTimeout(args: string[]): number {
  const flag = args.indexOf("--timeout");
  if (flag === -1) return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(args[flag + 1]);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`--timeout takes whole seconds from 1 to ${MAX_TIMEOUT_SECONDS}.`);
  }
  return seconds;
}

export async function listen(args: string[]): Promise<number> {
  let seconds: number;
  try {
    seconds = parseTimeout(args);
  } catch (error) {
    process.stderr.write(
      `${(error as Error).message}\nUsage: northstar listen [--timeout seconds]\n`,
    );
    return 2;
  }
  const root = process.env.NORTHSTAR_ROOT ?? process.cwd();
  const home = northstarHome();
  let peer: Awaited<ReturnType<typeof ensureDaemon>>;
  try {
    peer = await ensureDaemon(fileLogger(home), null, home);
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    process.stderr.write(`${error.message} ${error.fix}\n`);
    return 1;
  }
  try {
    const { template } = await peer.call<{ template: TemplateId | null }>(
      "listen.wait",
      { root, timeoutMs: seconds * 1000 },
      seconds * 1000 + 10_000,
    );
    if (template === null) {
      process.stdout.write("No new comments. Run northstar listen again.\n");
      return 0;
    }
    const open = await new CommentStore(root).list("open");
    const lines = open.length ? open.map(summarize).join("\n") : "No open comments.";
    process.stdout.write(
      `${templateLine(template)}\n\nOpen comments:\n${lines}\n\nWhen you are done, run northstar listen again.\n`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    process.stderr.write(`${error.message} ${error.fix}\n`);
    return 1;
  } finally {
    peer.close();
  }
}
