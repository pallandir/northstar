import { PROTOCOL_VERSION } from "@northstar/protocol";

export class HostFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fix: string,
  ) {
    super(message);
  }
}

export interface HostCall {
  action: string;
  params: Record<string, unknown>;
}

interface FakeHost {
  calls: HostCall[];
  connections: number;
  disconnect(message?: string): void;
}

type Handler = (action: string, params: Record<string, unknown>) => unknown;

interface FakePort {
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  postMessage(message: { id: string; action: string; params: Record<string, unknown> }): void;
  disconnect(): void;
}

export function installFakeHost(handler: Handler): FakeHost {
  const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
    .runtime;
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const host: FakeHost = {
    calls: [],
    connections: 0,
    disconnect(message) {
      runtime.lastError = message ? { message } : undefined;
      for (const listener of disconnectListeners.splice(0)) listener();
      messageListeners.length = 0;
      runtime.lastError = undefined;
    },
  };
  runtime.connectNative = (): FakePort => {
    host.connections += 1;
    return {
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
      postMessage: ({ id, action, params }) => {
        host.calls.push({ action, params });
        setTimeout(() => {
          let reply: Record<string, unknown>;
          try {
            reply = {
              version: PROTOCOL_VERSION,
              id,
              ok: true,
              result: handler(action, params),
            };
          } catch (error) {
            if (!(error instanceof HostFailure)) throw error;
            reply = {
              version: PROTOCOL_VERSION,
              id,
              ok: false,
              code: error.code,
              error: error.message,
              fix: error.fix,
            };
          }
          for (const listener of [...messageListeners]) listener(reply);
        }, 0);
      },
      disconnect: () => host.disconnect(),
    };
  };
  return host;
}

export function missingHost(): void {
  const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
    .runtime;
  runtime.connectNative = (): FakePort => {
    const listeners: Array<() => void> = [];
    queueMicrotask(() => {
      runtime.lastError = { message: "Specified native messaging host not found." };
      for (const listener of listeners) listener();
      runtime.lastError = undefined;
    });
    return {
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: (listener) => listeners.push(listener) },
      postMessage: () => {},
      disconnect: () => {},
    };
  };
}
