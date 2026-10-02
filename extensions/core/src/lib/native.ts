import {
  type ErrorCode,
  NATIVE_HOST_NAME,
  type NativeAction,
  type NativeResponse,
  PROTOCOL_VERSION,
} from "@northstar/protocol";
import { browser } from "./browser.js";
import { type FailureKind, UserError } from "./errors.js";

const FAST_TIMEOUT_MS = 20_000;
const SLOW_TIMEOUT_MS = 70_000;
const SLOW_ACTIONS = new Set<NativeAction>(["session.send", "quickrun.execute"]);

const INSTALL_FIX =
  "Run npm install -g @pallandir/northstar, then northstar install, then reload this page.";

export class BridgeError extends UserError {
  constructor(
    message: string,
    fix: string,
    kind: FailureKind,
    readonly code: ErrorCode | "NO_HELPER" | "HELPER_STOPPED",
  ) {
    super(message, fix, kind);
    this.name = "BridgeError";
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let port: chrome.runtime.Port | null = null;
let counter = 0;
const pending = new Map<string, Pending>();

function kindOf(code: ErrorCode): FailureKind {
  if (code === "DAEMON_UNAVAILABLE") return "offline";
  if (code === "VERSION_MISMATCH") return "mismatch";
  if (code === "NO_PROJECT") return "offline";
  return "api";
}

function disconnectError(message: string | undefined): BridgeError {
  if (message && /not found/i.test(message)) {
    return new BridgeError(
      "Northstar's browser helper is not installed.",
      INSTALL_FIX,
      "offline",
      "NO_HELPER",
    );
  }
  if (message && /forbidden/i.test(message)) {
    return new BridgeError(
      "The Northstar helper does not allow this extension.",
      "Reload this page. Northstar allows unpacked builds it finds in Chrome when its helper starts, so if this persists run northstar doctor. A Web Store build older than this package also needs updating.",
      "offline",
      "NO_HELPER",
    );
  }
  return new BridgeError(
    `The Northstar helper stopped${message ? `: ${message}` : "."}`,
    "Run northstar doctor, then try again.",
    "offline",
    "HELPER_STOPPED",
  );
}

function onMessage(raw: unknown): void {
  const message = raw as Partial<NativeResponse> | null;
  if (!message || typeof message.id !== "string") {
    console.error("[northstar] the helper sent an unreadable message", raw);
    return;
  }
  const waiting = pending.get(message.id);
  if (!waiting) return;
  pending.delete(message.id);
  clearTimeout(waiting.timer);
  if (message.ok === true) {
    waiting.resolve((message as { result: unknown }).result);
    return;
  }
  const failure = message as { code?: ErrorCode; error?: string; fix?: string };
  const code = failure.code ?? "INTERNAL";
  waiting.reject(
    new BridgeError(
      failure.error ?? "The Northstar helper reported an unreadable error.",
      failure.fix ?? "Run northstar doctor, then try again.",
      kindOf(code),
      code,
    ),
  );
}

function onDisconnect(closed: chrome.runtime.Port): void {
  const message =
    browser.runtime.lastError?.message ?? (closed as { error?: Error }).error?.message;
  if (port === closed) port = null;
  const error = disconnectError(message);
  for (const [, waiting] of pending) {
    clearTimeout(waiting.timer);
    waiting.reject(error);
  }
  pending.clear();
}

function open(): chrome.runtime.Port {
  if (port) return port;
  let next: chrome.runtime.Port;
  try {
    next = browser.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (err) {
    throw disconnectError((err as Error).message);
  }
  next.onMessage.addListener(onMessage);
  next.onDisconnect.addListener(() => onDisconnect(next));
  port = next;
  return next;
}

export function request<T>(
  action: NativeAction,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let target: chrome.runtime.Port;
    try {
      target = open();
    } catch (err) {
      reject(err);
      return;
    }
    counter += 1;
    const id = `${Date.now().toString(36)}-${counter}`;
    const limit = timeoutMs ?? (SLOW_ACTIONS.has(action) ? SLOW_TIMEOUT_MS : FAST_TIMEOUT_MS);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new BridgeError(
          "The Northstar helper did not answer in time.",
          "Run northstar doctor, then try again.",
          "offline",
          "HELPER_STOPPED",
        ),
      );
    }, limit);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    try {
      target.postMessage({ version: PROTOCOL_VERSION, id, action, params });
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      port = null;
      reject(disconnectError((err as Error).message));
    }
  });
}

export function closeHelper(): void {
  const current = port;
  port = null;
  current?.disconnect();
}
