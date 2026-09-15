import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Broker } from "./broker.js";
import { startIngestServer } from "./http.js";
import { createMcpServer } from "./server.js";
import { CommentStore } from "./store.js";
import { TerminalHandoff } from "./terminal/index.js";

const DEFAULT_PORTS = [7474, 7475, 7476];

function parsePorts(): number[] {
  const fromEnv = process.env.NORTHSTAR_PORT;
  if (!fromEnv) return DEFAULT_PORTS;
  const port = Number(fromEnv);
  return Number.isInteger(port) ? [port, ...DEFAULT_PORTS] : DEFAULT_PORTS;
}

async function main(): Promise<void> {
  const root = process.env.NORTHSTAR_ROOT ?? process.cwd();
  const store = new CommentStore(root);
  const broker = new Broker();

  const log = (msg: string) => process.stderr.write(`[northstar] ${msg}\n`);
  const handoff = new TerminalHandoff(log);

  const ingest = await startIngestServer(store, parsePorts(), log, broker, handoff);
  log(`ingest listening on http://127.0.0.1:${ingest.port}, store root ${root}`);

  const terminal = await handoff.describe();
  log(
    terminal.available
      ? `terminal handoff via ${terminal.driver}`
      : `no handoff: ${terminal.reason}`,
  );

  const server = createMcpServer(store, broker);
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await ingest.close();
    process.exit(0);
  };

  transport.onclose = () => void shutdown();
  process.stdin.on("end", () => void shutdown());
  process.stdin.on("close", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());

  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[northstar] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
