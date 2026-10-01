import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type Server, createServer } from "node:net";
import { test } from "node:test";

const PORTS = [7474, 7475, 7476];

function occupy(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("the MCP server keeps serving when every ingest port is busy", async (t) => {
  const held = await Promise.all(PORTS.map(occupy));
  t.after(() => {
    for (const server of held) server?.close();
  });

  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NORTHSTAR_ROOT: process.cwd() },
  });
  t.after(() => child.kill());

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const reply = new Promise<string>((resolve) => {
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes('"id":1')) resolve(stdout);
    });
  });

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    })}\n`,
  );

  const response = await reply;
  assert.match(response, /"name":"northstar"/);
  assert.match(stderr, /ingest disabled/);
});
