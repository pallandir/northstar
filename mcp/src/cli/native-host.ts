import { ensureDaemon } from "../daemon/client.js";
import { fileLogger } from "../daemon/log.js";
import { northstarHome } from "../lib/home.js";
import { runHost, verifyCaller } from "../native/host.js";

export async function nativeHostCommand(args: string[]): Promise<number> {
  const home = northstarHome();
  const log = fileLogger(home);
  try {
    verifyCaller(args, home);
  } catch (error) {
    log(`refused caller ${args.join(" ")}: ${(error as Error).message}`);
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
  log("native host connected");
  await runHost({
    input: process.stdin,
    output: process.stdout,
    connect: () => ensureDaemon(log, null, home),
    log,
  });
  log("native host disconnected");
  return 0;
}
