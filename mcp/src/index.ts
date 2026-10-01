import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getCanon } from "./assets.js";
import { DaemonLink } from "./daemon/link.js";
import { createMcpServer } from "./server.js";
import { CommentStore } from "./store.js";

async function main(): Promise<void> {
  const root = process.env.NORTHSTAR_ROOT ?? process.cwd();
  const store = new CommentStore(root);

  const log = (msg: string) => process.stderr.write(`[northstar] ${msg}\n`);
  process.on("unhandledRejection", (reason) => {
    log(
      `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });

  const link = new DaemonLink({ root, log });
  const server = createMcpServer(store, link, getCanon(), { root, bridge: () => link.status() });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  transport.onclose = shutdown;
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

  await server.connect(transport);

  const status = await link.start();
  log(
    status.state === "on"
      ? `Send to AI is linked to the Northstar daemon, store root ${root}`
      : `Send to AI is unavailable: ${status.error}. Start the agent with northstar run so the daemon is running.`,
  );
}

main().catch((err) => {
  process.stderr.write(`[northstar] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
