import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getCanon } from "./assets.js";
import { DaemonLink } from "./daemon/link.js";
import { SURFACES, type Surface, createCommentsServer, createDesignServer } from "./server.js";
import { CommentStore } from "./store.js";

export function parseSurface(value: string | undefined): Surface {
  if (value === undefined) return "design";
  if ((SURFACES as readonly string[]).includes(value)) return value as Surface;
  throw new Error(
    `Unknown server ${value}. Use northstar serve design or northstar serve comments.`,
  );
}

async function main(surface: Surface): Promise<void> {
  if (process.env.NORTHSTAR_PACKS !== undefined) {
    throw new Error(
      "NORTHSTAR_PACKS was removed, every tool is always available now. Delete NORTHSTAR_PACKS from the northstar MCP server entry, or run northstar install to rewrite it.",
    );
  }
  const root = process.env.NORTHSTAR_ROOT ?? process.cwd();
  const log = (msg: string) => process.stderr.write(`[northstar] ${msg}\n`);
  process.on("unhandledRejection", (reason) => {
    log(
      `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });

  const link = surface === "comments" ? new DaemonLink({ root, log }) : null;
  const server =
    link === null
      ? createDesignServer(getCanon(), { root })
      : createCommentsServer(new CommentStore(root), link, getCanon(), { root });

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

  if (link) {
    const status = await link.start();
    log(
      status.state === "on"
        ? `Send to AI is linked to the Northstar daemon, store root ${root}`
        : `Send to AI is unavailable: ${status.error}. Run northstar doctor.`,
    );
  }
}

export function serve(surface: Surface): void {
  main(surface).catch((err) => {
    process.stderr.write(`[northstar] fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
