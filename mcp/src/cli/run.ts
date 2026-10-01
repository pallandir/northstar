import { RpcError } from "../daemon/rpc.js";
import { RunError, runAgent } from "../pty/run.js";

export async function run(args: string[]): Promise<number> {
  const [agent, ...rest] = args;
  if (!agent) {
    process.stderr.write("Usage: northstar run <agent> [agent arguments]\n");
    return 2;
  }
  try {
    return await runAgent(agent, rest);
  } catch (error) {
    if (error instanceof RunError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    if (error instanceof RpcError) {
      process.stderr.write(`${error.message} ${error.fix}\n`);
      return 1;
    }
    throw error;
  }
}
