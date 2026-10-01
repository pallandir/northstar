import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { type Server, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const PORTS = [7474, 7475, 7476];

function occupy(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("when every ingest port is busy the tools keep working and the error is reported", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "northstar-busy-"));
  const held = await Promise.all(PORTS.map(occupy));
  t.after(() => {
    for (const server of held) server?.close();
  });

  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NORTHSTAR_ROOT: process.cwd(), NORTHSTAR_HOME: home },
  });
  t.after(() => child.kill());

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let stdout = "";
  const waitFor = (needle: string) =>
    new Promise<string>((resolve) => {
      const check = () => {
        if (stdout.includes(needle)) resolve(stdout);
      };
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        check();
      });
      check();
    });
  const reply = waitFor('"id":1');

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
  assert.match(stderr, /ingest disabled: Every Northstar port is busy/);

  const context = waitFor('"id":2');
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "northstar_context", arguments: {} },
    })}\n`,
  );
  const answer = await context;
  assert.match(answer, /channel/);
  assert.match(answer, /Every Northstar port is busy/);
});
