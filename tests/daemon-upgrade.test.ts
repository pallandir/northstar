import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { connectDaemon } from "../mcp/src/daemon/client.js";
import { type RunningDaemon, startDaemon } from "../mcp/src/daemon/server.js";
import { runtimeDir } from "../mcp/src/lib/home.js";

test(
  "a daemon from the previous wire format on the old socket does not block the new one",
  { timeout: 20_000 },
  async () => {
    const home = mkdtempSync(join("/tmp", "ns-up-"));
    mkdirSync(runtimeDir(home), { recursive: true, mode: 0o700 });
    const old = createServer((socket) => socket.on("data", () => socket.destroy()));
    let running: RunningDaemon | undefined;
    try {
      await new Promise<void>((resolve) =>
        old.listen(join(runtimeDir(home), "northstar.sock"), resolve),
      );
      running = await startDaemon({ home, version: "9.9.9", log: () => {}, idleExitMs: 60_000 });
      const peer = await connectDaemon(() => {}, null, home);
      const reply = await peer.call<{ version: string }>("request", {
        action: "system.info",
        params: {},
      });
      assert.equal(reply.version, "9.9.9");
      peer.close();
    } finally {
      await running?.close();
      old.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
