import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import {
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
  MAX_REPLY_BYTES,
  MAX_REQUEST_BYTES,
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
} from "@northstar/protocol";
import { connectDaemon } from "../mcp/src/daemon/client.js";
import { RpcError, type RpcPeer } from "../mcp/src/daemon/rpc.js";
import { type RunningDaemon, startDaemon } from "../mcp/src/daemon/server.js";
import { FrameError, FrameReader, encodeFrame } from "../mcp/src/native/framing.js";
import { runHost, verifyCaller } from "../mcp/src/native/host.js";
import { draft } from "./helpers.js";

test("a frame is a four byte little endian length and UTF-8 JSON", () => {
  const frame = encodeFrame('{"a":"héllo ✓"}');
  assert.equal(frame.readUInt32LE(0), Buffer.byteLength('{"a":"héllo ✓"}'));
  const frames = new FrameReader(1024).push(frame);
  assert.equal(frames[0]?.toString("utf8"), '{"a":"héllo ✓"}');
});

test("partial reads, back to back frames and empty frames are reassembled", () => {
  const reader = new FrameReader(1024);
  const wire = Buffer.concat([encodeFrame("one"), encodeFrame(""), encodeFrame("three")]);
  const seen: string[] = [];
  for (const byte of wire) {
    for (const frame of reader.push(Buffer.from([byte]))) seen.push(frame.toString("utf8"));
  }
  assert.deepEqual(seen, ["one", "", "three"]);
  assert.equal(reader.pending, 0);
  const batch = new FrameReader(1024).push(wire);
  assert.equal(batch.length, 3);
});

test("a length over the limit is refused before the body arrives", () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(2_000, 0);
  assert.throws(() => new FrameReader(1_000).push(header), FrameError);
  header.writeUInt32LE(0xffffffff, 0);
  assert.throws(() => new FrameReader(MAX_REQUEST_BYTES).push(header), /byte limit/);
});

test("a large frame survives a round trip", () => {
  const big = "x".repeat(5 * 1024 * 1024);
  const [frame] = new FrameReader(MAX_REQUEST_BYTES).push(encodeFrame(big));
  assert.equal(frame?.length, big.length);
});

let home: string;
let project: string;
let running: RunningDaemon;
let peers: RpcPeer[];

beforeEach(async () => {
  home = mkdtempSync(join("/tmp", "ns-host-"));
  project = mkdtempSync(join("/tmp", "ns-hproj-"));
  peers = [];
  running = await startDaemon({
    home,
    version: "9.9.9",
    log: () => {},
    idleExitMs: 60_000,
    launchQuickRun: () => {
      throw new Error("no quick run in this test");
    },
  });
  const agent = await connectDaemon(() => {}, null, home);
  peers.push(agent);
  await agent.call("mcp.hello", { root: project, ancestors: [] });
});

afterEach(async () => {
  for (const peer of peers) peer.close();
  await running.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

interface Host {
  send(message: unknown): void;
  sendRaw(bytes: Buffer): void;
  next(): Promise<Record<string, unknown>>;
  end(): Promise<void>;
  input: PassThrough;
}

function host(connect?: () => Promise<RpcPeer>): Host {
  const input = new PassThrough();
  const output = new PassThrough();
  const reader = new FrameReader(MAX_REPLY_BYTES * 4);
  const queue: Array<Record<string, unknown>> = [];
  const waiting: Array<(value: Record<string, unknown>) => void> = [];
  output.on("data", (chunk: Buffer) => {
    for (const frame of reader.push(chunk)) {
      const parsed = JSON.parse(frame.toString("utf8")) as Record<string, unknown>;
      const resolve = waiting.shift();
      if (resolve) resolve(parsed);
      else queue.push(parsed);
    }
  });
  const done = runHost({
    input,
    output,
    log: () => {},
    connect:
      connect ??
      (async () => {
        const peer = await connectDaemon(() => {}, null, home);
        peers.push(peer);
        return peer;
      }),
  });
  return {
    input,
    send: (message) => input.write(encodeFrame(JSON.stringify(message))),
    sendRaw: (bytes) => input.write(bytes),
    next: () => {
      const ready = queue.shift();
      return ready
        ? Promise.resolve(ready)
        : new Promise((resolve) => {
            waiting.push(resolve);
          });
    },
    end: async () => {
      input.end();
      await done;
    },
  };
}

const envelope = (id: string, action: string, params: unknown = {}) => ({
  version: PROTOCOL_VERSION,
  id,
  action,
  params,
});

test("a request goes through the host to the daemon and the answer carries the same id", async () => {
  const h = host();
  h.send(envelope("r1", "system.info"));
  const reply = await h.next();
  assert.equal(reply.ok, true);
  assert.equal(reply.id, "r1");
  assert.equal(reply.version, PROTOCOL_VERSION);
  assert.equal((reply.result as { version: string }).version, "9.9.9");
  await h.end();
});

test("a request split across chunks and two requests in one chunk are both answered", async () => {
  const h = host();
  const wire = encodeFrame(JSON.stringify(envelope("a", "session.list")));
  h.sendRaw(wire.subarray(0, 3));
  h.sendRaw(wire.subarray(3, 9));
  h.sendRaw(
    Buffer.concat([wire.subarray(9), encodeFrame(JSON.stringify(envelope("b", "agent.list")))]),
  );
  const replies = [await h.next(), await h.next()];
  assert.deepEqual(replies.map((r) => r.id).sort(), ["a", "b"]);
  assert.ok(replies.every((r) => r.ok === true));
  await h.end();
});

test("malformed JSON and binary data are refused, and invalid unicode never crashes the host", async () => {
  const h = host();
  h.sendRaw(encodeFrame("{ not json"));
  h.sendRaw(encodeFrame(Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x81])));
  for (let i = 0; i < 2; i += 1) {
    const reply = await h.next();
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "BAD_REQUEST");
    assert.ok(typeof reply.fix === "string" && reply.fix.length > 0);
  }
  const body = Buffer.concat([
    Buffer.from(`{"version":${PROTOCOL_VERSION},"id":"`),
    Buffer.from([0xff, 0xfe]),
    Buffer.from('","action":"system.info","params":{}}'),
  ]);
  h.sendRaw(encodeFrame(body));
  const survived = await h.next();
  assert.equal(typeof survived.id, "string");
  h.send(envelope("after", "system.info"));
  assert.equal((await h.next()).ok, true);
  await h.end();
});

test("an unknown action is refused by name and never evaluated", async () => {
  const h = host();
  for (const action of ["shell.exec", "session.kill", "__proto__", "sh -c id", ""]) {
    h.send({ ...envelope("x1", "system.info"), action });
    const reply = await h.next();
    assert.equal(reply.code, "UNSUPPORTED_ACTION", action);
    assert.equal(reply.id, "x1");
  }
  h.send({ version: PROTOCOL_VERSION, id: "x2" });
  assert.equal((await h.next()).code, "UNSUPPORTED_ACTION");
  await h.end();
});

test("a version mismatch names the side to update", async () => {
  const h = host();
  h.send({ ...envelope("v1", "system.info"), version: PROTOCOL_VERSION - 1 });
  const older = await h.next();
  assert.equal(older.code, "VERSION_MISMATCH");
  assert.match(older.fix as string, /browser extension/);
  h.send({ ...envelope("v2", "system.info"), version: PROTOCOL_VERSION + 1 });
  assert.match((await h.next()).fix as string, /npm install -g @pallandir\/northstar/);
  await h.end();
});

test("an envelope with extra keys, a shell string or a fake session is refused", async () => {
  const h = host();
  h.send({ ...envelope("e1", "system.info"), shell: "rm -rf ~" });
  assert.equal((await h.next()).code, "BAD_REQUEST");
  h.send({ ...envelope("e2", "system.info"), command: "id" });
  assert.equal((await h.next()).code, "BAD_REQUEST");
  h.send(envelope("e3", "session.send", { root: project, template: '"; rm -rf ..."' }));
  assert.equal((await h.next()).code, "BAD_REQUEST");
  h.send(envelope("e4", "session.send", { root: project, template: "resolve", sessionId: "../x" }));
  const fake = await h.next();
  assert.ok(
    fake.code === "SESSION_NOT_FOUND" || fake.code === "BAD_REQUEST" || fake.code === "NO_SESSION",
  );
  await h.end();
});

test("a frame over the size limit is refused and the host stops reading", async () => {
  const h = host();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(0xffffffff, 0);
  h.sendRaw(header);
  const reply = await h.next();
  assert.equal(reply.ok, false);
  assert.match(reply.error as string, /byte limit/);
  await h.end();
});

test("an answer larger than the browser accepts is replaced by an error with a fix", async () => {
  const h = host();
  const drafts = Array.from({ length: 200 }, (_, i) =>
    draft({ cid: `big-${i}`, comment: "y".repeat(8_000) }),
  );
  h.send(envelope("w", "comments.add", { root: project, drafts }));
  const added = await h.next();
  assert.equal(added.ok, true, JSON.stringify(added));
  h.send(envelope("l", "comments.list", { root: project, page: "http://localhost:3000/" }));
  const reply = await h.next();
  assert.equal(reply.code, "REPLY_TOO_LARGE");
  assert.match(reply.fix as string, /Clear resolved comments/);
  await h.end();
});

test("a missing daemon is reported with how to start it", async () => {
  const h = host(async () => {
    throw new RpcError(
      "DAEMON_UNAVAILABLE",
      "The Northstar daemon did not start.",
      "Run northstar daemon.",
    );
  });
  h.send(envelope("d", "system.info"));
  const reply = await h.next();
  assert.equal(reply.code, "DAEMON_UNAVAILABLE");
  assert.equal(reply.fix, "Run northstar daemon.");
  await h.end();
});

const CHROME = `chrome-extension://${CHROME_EXTENSION_ID}/`;

test("only the Northstar extension may start the host", () => {
  assert.doesNotThrow(() => verifyCaller([CHROME], home));
  assert.doesNotThrow(() =>
    verifyCaller([`/x/${NATIVE_HOST_NAME}.json`, FIREFOX_EXTENSION_ID], home),
  );
  const refused = [
    [],
    ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
    [`chrome-extension://${CHROME_EXTENSION_ID}/evil`],
    [`chrome-extension://${CHROME_EXTENSION_ID}`],
    [`https://${CHROME_EXTENSION_ID}/`],
    ["/x/other.json", FIREFOX_EXTENSION_ID],
    [`/x/${NATIVE_HOST_NAME}.json`, "evil@example.com"],
    [`/x/${NATIVE_HOST_NAME}.json`],
  ];
  for (const argv of refused)
    assert.throws(() => verifyCaller(argv, home), /Northstar/, argv.join(" "));
});

test("an extension id the user allowed for an unpacked build is accepted, a malformed list is an error", () => {
  const dev = "abcdefghijklmnopabcdefghijklmnop";
  mkdirSync(join(home, ".northstar", "state"), { recursive: true });
  writeFileSync(
    join(home, ".northstar", "state", "extension-ids.json"),
    JSON.stringify({ ids: [dev] }),
  );
  assert.doesNotThrow(() => verifyCaller([`chrome-extension://${dev}/`], home));
  assert.throws(() => verifyCaller(["chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/"], home));
  writeFileSync(join(home, ".northstar", "state", "extension-ids.json"), '{"ids": 3}');
  assert.throws(() => verifyCaller([CHROME], home), /must hold/);
});
