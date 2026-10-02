import type { Socket } from "node:net";
import type { ErrorCode } from "@northstar/protocol";

const MAX_LINE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export class RpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fix: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

interface Frame {
  id: number;
  method?: string;
  params?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: { code: ErrorCode; message: string; fix: string };
}

export type RpcHandler = (method: string, params: unknown) => Promise<unknown>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RpcPeer {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";
  private closed = false;
  private readonly closeListeners: Array<() => void> = [];

  constructor(
    private readonly socket: Socket,
    private readonly handler: RpcHandler | null,
    private readonly log: (message: string) => void,
  ) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (error) => this.log(`socket error: ${error.message}`));
    socket.on("close", () => this.onClosed());
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onClose(listener: () => void): void {
    if (this.closed) listener();
    else this.closeListeners.push(listener);
  }

  call<T>(method: string, params: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new RpcError(
          "DAEMON_UNAVAILABLE",
          "The Northstar daemon connection is closed.",
          "Run northstar daemon, then try again.",
        ),
      );
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RpcError(
            "DAEMON_UNAVAILABLE",
            `The Northstar daemon did not answer ${method} within ${Math.round(timeoutMs / 1000)} seconds.`,
            "Run northstar daemon stop, then try again.",
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send({ id, method, params });
    });
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }

  private send(frame: Frame): void {
    if (this.closed) return;
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.log("peer sent a frame over the size limit, closing");
      this.close();
      return;
    }
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (line.length > 0) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      this.log("peer sent a frame that is not JSON, closing");
      this.close();
      return;
    }
    if (typeof frame.id !== "number") {
      this.log("peer sent a frame without an id, closing");
      this.close();
      return;
    }
    if (typeof frame.method === "string") {
      void this.serve(frame.id, frame.method, frame.params);
      return;
    }
    const waiting = this.pending.get(frame.id);
    if (!waiting) return;
    this.pending.delete(frame.id);
    clearTimeout(waiting.timer);
    if (frame.ok) {
      waiting.resolve(frame.result);
    } else {
      const error = frame.error;
      waiting.reject(
        new RpcError(
          error?.code ?? "INTERNAL",
          error?.message ?? "The Northstar daemon sent an unreadable error.",
          error?.fix ?? "Run northstar doctor.",
        ),
      );
    }
  }

  private async serve(id: number, method: string, params: unknown): Promise<void> {
    if (!this.handler) {
      this.send({
        id,
        ok: false,
        error: {
          code: "UNSUPPORTED_ACTION",
          message: `This peer does not serve ${method}.`,
          fix: "Update Northstar.",
        },
      });
      return;
    }
    try {
      this.send({ id, ok: true, result: await this.handler(method, params) });
    } catch (error) {
      if (error instanceof RpcError) {
        this.send({
          id,
          ok: false,
          error: { code: error.code, message: error.message, fix: error.fix },
        });
        return;
      }
      this.log(`internal error in ${method}: ${(error as Error).stack ?? String(error)}`);
      this.send({
        id,
        ok: false,
        error: {
          code: "INTERNAL",
          message: `Northstar hit an internal error in ${method}.`,
          fix: "Run northstar doctor, then try again.",
        },
      });
    }
  }

  private onClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(
        new RpcError(
          "DAEMON_UNAVAILABLE",
          "The Northstar daemon connection closed.",
          "Run northstar daemon, then try again.",
        ),
      );
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }
}

export function badRequest(message: string, fix: string): RpcError {
  return new RpcError("BAD_REQUEST", message, fix);
}
