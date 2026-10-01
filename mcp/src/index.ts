import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_PORTS } from "@northstar/protocol";
import { getCanon } from "./assets.js";
import { Broker } from "./broker.js";
import { AgentDelivery } from "./delivery.js";
import { startIngestServer } from "./http.js";
import type { IngestStatus } from "./ingest-status.js";
import { createMcpServer } from "./server.js";
import { CommentStore } from "./store.js";
import { TerminalTyper } from "./terminal/index.js";

function parsePorts(): number[] {
  const fromEnv = process.env.NORTHSTAR_PORT;
  if (fromEnv === undefined || fromEnv === "") return [...SERVER_PORTS];
  const port = Number(fromEnv);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `NORTHSTAR_PORT is "${fromEnv}", which is not a port. Set it to a number from 1 to 65535 or unset it.`,
    );
  }
  return [port, ...SERVER_PORTS];
}

async function main(): Promise<void> {
  const root = process.env.NORTHSTAR_ROOT ?? process.cwd();
  const ports = parsePorts();
  const store = new CommentStore(root);
  const broker = new Broker();

  const log = (msg: string) => process.stderr.write(`[northstar] ${msg}\n`);
  process.on("unhandledRejection", (reason) => {
    log(
      `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });

  const terminal = new TerminalTyper(log);
  let ingestStatus: IngestStatus = { state: "off", error: "the ingest server has not started yet" };
  const server = createMcpServer(store, broker, getCanon(), { root, ingest: () => ingestStatus });
  const delivery = new AgentDelivery({
    server: server.server,
    broker,
    terminal,
    log,
    openCount: async () => (await store.list("open")).length,
  });

  let ingest: Awaited<ReturnType<typeof startIngestServer>> | null = null;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await ingest?.close();
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  transport.onclose = () => void shutdown();
  process.stdin.on("end", () => void shutdown());
  process.stdin.on("close", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());

  await server.connect(transport);

  try {
    ingest = await startIngestServer(store, ports, log, broker, delivery);
    ingestStatus = { state: "on", port: ingest.port };
    log(`ingest listening on http://127.0.0.1:${ingest.port}, store root ${root}`);
  } catch (err) {
    const message = (err as Error).message;
    ingestStatus = { state: "off", error: message };
    log(`ingest disabled: ${message}`);
  }

  const readiness = await delivery.readiness();
  log(
    readiness.ready
      ? `Send to AI wakes ${readiness.agent} via ${readiness.via}`
      : `Send to AI is disabled: ${readiness.reason} ${readiness.fix ?? ""}`,
  );
}

main().catch((err) => {
  process.stderr.write(`[northstar] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
