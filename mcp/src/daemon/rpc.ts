import type { Socket } from "node:net";
import type { ErrorCode } from "@northstar/protocol";
import {
  CancellationTokenSource,
  type MessageConnection,
  ResponseError,
  createMessageConnection,
} from "vscode-jsonrpc";
import { StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

const DEFAULT_TIMEOUT_MS = 30_000;
const SERVER_ERROR = -32000;

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

interface ErrorData {
  code: ErrorCode;
  fix: string;
}

export type RpcHandler = (method: string, params: unknown) => Promise<unknown>;

const unavailable = (message: string) =>
  new RpcError("DAEMON_UNAVAILABLE", message, "Run northstar daemon, then try again.");

export class RpcPeer {
  private readonly connection: MessageConnection;
  private closed = false;
  private readonly closeListeners: Array<() => void> = [];

  constructor(
    private readonly socket: Socket,
    handler: RpcHandler | null,
    private readonly log: (message: string) => void,
  ) {
    this.connection = createMessageConnection(
      new StreamMessageReader(socket),
      new StreamMessageWriter(socket),
    );
    this.connection.onRequest((method, params) => this.serve(handler, method, params));
    this.connection.onError(([error]) => this.log(`rpc error: ${error.message}`));
    this.connection.onClose(() => this.onClosed());
    socket.on("error", (error) => this.log(`socket error: ${error.message}`));
    this.connection.listen();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onClose(listener: () => void): void {
    if (this.closed) listener();
    else this.closeListeners.push(listener);
  }

  async call<T>(
    method: string,
    params: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed) throw unavailable("The Northstar daemon connection is closed.");
    const source = new CancellationTokenSource();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      source.cancel();
    }, timeoutMs);
    try {
      return await this.connection.sendRequest<T>(method, params, source.token);
    } catch (error) {
      if (timedOut) {
        throw new RpcError(
          "DAEMON_UNAVAILABLE",
          `The Northstar daemon did not answer ${method} within ${Math.round(timeoutMs / 1000)} seconds.`,
          "Run northstar daemon stop, then try again.",
        );
      }
      if (error instanceof ResponseError) {
        const data = error.data as ErrorData | undefined;
        throw new RpcError(
          data?.code ?? "INTERNAL",
          error.message,
          data?.fix ?? "Run northstar doctor.",
        );
      }
      throw unavailable("The Northstar daemon connection closed.");
    } finally {
      clearTimeout(timer);
      source.dispose();
    }
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }

  private async serve(handler: RpcHandler | null, method: string, params: unknown) {
    if (!handler) {
      throw new ResponseError<ErrorData>(SERVER_ERROR, `This peer does not serve ${method}.`, {
        code: "UNSUPPORTED_ACTION",
        fix: "Update Northstar.",
      });
    }
    try {
      return await handler(method, params);
    } catch (error) {
      if (error instanceof RpcError) {
        throw new ResponseError<ErrorData>(SERVER_ERROR, error.message, {
          code: error.code,
          fix: error.fix,
        });
      }
      this.log(`internal error in ${method}: ${(error as Error).stack ?? String(error)}`);
      throw new ResponseError<ErrorData>(
        SERVER_ERROR,
        `Northstar hit an internal error in ${method}.`,
        { code: "INTERNAL", fix: "Run northstar doctor, then try again." },
      );
    }
  }

  private onClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.dispose();
    for (const listener of this.closeListeners) listener();
  }
}

export function badRequest(message: string, fix: string): RpcError {
  return new RpcError("BAD_REQUEST", message, fix);
}
