import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  ACTIONS,
  CHROME_EXTENSION_ID,
  type ErrorCode,
  FIREFOX_EXTENSION_ID,
  MAX_REPLY_BYTES,
  MAX_REQUEST_BYTES,
  NATIVE_HOST_NAME,
  type NativeFailure,
  type NativeSuccess,
  PROTOCOL_VERSION,
  requestSchema,
} from "@northstar/protocol";
import { RpcError, type RpcPeer } from "../daemon/rpc.js";
import { northstarHome, stateDir } from "../lib/home.js";
import { FrameError, FrameReader, encodeFrame } from "./framing.js";

const SLOW_ACTIONS = new Set(["session.send", "quickrun.execute"]);
const SLOW_TIMEOUT_MS = 60_000;
const FAST_TIMEOUT_MS = 15_000;

export const EXTENSION_IDS_FILE = "extension-ids.json";

export function extraExtensionIds(home: string = northstarHome()): string[] {
  const path = join(stateDir(home), EXTENSION_IDS_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { ids?: unknown };
  if (!Array.isArray(parsed.ids) || !parsed.ids.every((id) => typeof id === "string")) {
    throw new Error(`${path} must hold {"ids": ["<extension id>"]}. Delete it or fix it.`);
  }
  return parsed.ids as string[];
}

export function verifyCaller(argv: readonly string[], home: string = northstarHome()): void {
  const chromeOrigin = /^chrome-extension:\/\/([a-p]{32})\/$/.exec(argv[0] ?? "");
  if (chromeOrigin) {
    const id = chromeOrigin[1] as string;
    const allowed = [CHROME_EXTENSION_ID, ...extraExtensionIds(home)];
    if (!allowed.includes(id)) {
      throw new Error(`The extension ${id} is not allowed to talk to Northstar.`);
    }
    return;
  }
  if (basename(argv[0] ?? "") === `${NATIVE_HOST_NAME}.json` && argv[1] === FIREFOX_EXTENSION_ID) {
    return;
  }
  throw new Error(
    "Northstar's native host only answers the Northstar browser extension. Start it from Chrome or Firefox.",
  );
}

function failure(id: string, code: ErrorCode, error: string, fix: string): NativeFailure {
  return { version: PROTOCOL_VERSION, id, ok: false, code, error, fix };
}

interface HostOptions {
  input: Readable;
  output: Writable;
  connect: () => Promise<RpcPeer>;
  log: (message: string) => void;
}

export function runHost(options: HostOptions): Promise<void> {
  const { input, output, log } = options;
  const reader = new FrameReader(MAX_REQUEST_BYTES);
  let peer: RpcPeer | null = null;
  let opening: Promise<RpcPeer> | null = null;
  const inflight = new Set<Promise<void>>();

  const daemon = async (): Promise<RpcPeer> => {
    if (peer && !peer.isClosed) return peer;
    opening ??= options.connect().finally(() => {
      opening = null;
    });
    peer = await opening;
    return peer;
  };

  const send = (message: NativeSuccess | NativeFailure): void => {
    const json = JSON.stringify(message);
    if (Buffer.byteLength(json) > MAX_REPLY_BYTES) {
      output.write(
        encodeFrame(
          JSON.stringify(
            failure(
              message.id,
              "REPLY_TOO_LARGE",
              "Northstar's answer is larger than the browser accepts from a helper.",
              "Clear resolved comments or save fewer comments on this page.",
            ),
          ),
        ),
      );
      return;
    }
    output.write(encodeFrame(json));
  };

  const handle = async (frame: Buffer): Promise<void> => {
    let raw: unknown;
    try {
      raw = JSON.parse(frame.toString("utf8"));
    } catch {
      send(
        failure(
          "",
          "BAD_REQUEST",
          "The message is not valid JSON.",
          "Update the Northstar extension.",
        ),
      );
      return;
    }
    const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : "";
    const action = (raw as { action?: unknown })?.action;
    if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
      send(
        failure(
          id,
          "UNSUPPORTED_ACTION",
          `Northstar does not know the action ${String(action)}.`,
          "Update the Northstar extension and the Northstar package so both match.",
        ),
      );
      return;
    }
    const version = (raw as { version?: unknown }).version;
    if (version !== PROTOCOL_VERSION) {
      const older = typeof version === "number" && version < PROTOCOL_VERSION;
      send(
        failure(
          id,
          "VERSION_MISMATCH",
          "The extension and the Northstar package versions differ.",
          older
            ? "Update the Northstar browser extension."
            : "Update Northstar with npm install -g @pallandir/northstar, then northstar install.",
        ),
      );
      return;
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      send(
        failure(
          id,
          "BAD_REQUEST",
          `The request is invalid at ${issue?.path.join(".") || "the envelope"}: ${issue?.message}.`,
          "Update the Northstar extension.",
        ),
      );
      return;
    }
    try {
      const connection = await daemon();
      const result = await connection.call(
        "request",
        { action: parsed.data.action, params: parsed.data.params },
        SLOW_ACTIONS.has(parsed.data.action) ? SLOW_TIMEOUT_MS : FAST_TIMEOUT_MS,
      );
      send({ version: PROTOCOL_VERSION, id: parsed.data.id, ok: true, result });
    } catch (error) {
      if (error instanceof RpcError) {
        send(failure(parsed.data.id, error.code, error.message, error.fix));
        return;
      }
      log(`internal error: ${(error as Error).stack ?? String(error)}`);
      send(
        failure(
          parsed.data.id,
          "INTERNAL",
          "Northstar's native host hit an internal error.",
          "Run northstar doctor.",
        ),
      );
    }
  };

  return new Promise<void>((resolve) => {
    input.on("data", (chunk: Buffer) => {
      let frames: Buffer[];
      try {
        frames = reader.push(chunk);
      } catch (error) {
        if (!(error instanceof FrameError)) throw error;
        log(error.message);
        send(failure("", "BAD_REQUEST", error.message, "Send fewer comments at once."));
        input.destroy();
        return;
      }
      for (const frame of frames) {
        const work = handle(frame).finally(() => inflight.delete(work));
        inflight.add(work);
      }
    });
    input.on("end", () => {
      void Promise.allSettled([...inflight]).then(() => {
        peer?.close();
        resolve();
      });
    });
    input.on("close", () => {
      void Promise.allSettled([...inflight]).then(() => {
        peer?.close();
        resolve();
      });
    });
  });
}
