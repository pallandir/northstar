import { type IPty, spawn } from "@lydell/node-pty";
import type { DeliveryTarget } from "./deliver.js";
import { Screen } from "./screen.js";

interface PtySessionOptions {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  term?: string;
  onOutput?: (data: string) => void;
  onExit: (code: number) => void;
}

export class PtySession implements DeliveryTarget {
  readonly pid: number;
  private readonly pty: IPty;
  private readonly screen: Screen;
  private outputAt = Date.now();
  private userAt = 0;
  private held: string[] | null = null;

  constructor(options: PtySessionOptions) {
    this.screen = new Screen(options.cols, options.rows);
    this.pty = spawn(options.file, options.args, {
      name: options.term ?? "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
    });
    this.pid = this.pty.pid;
    this.pty.onData((data) => {
      this.outputAt = Date.now();
      this.screen.write(data);
      options.onOutput?.(data);
    });
    this.pty.onExit(({ exitCode }) => {
      this.screen.dispose();
      options.onExit(exitCode);
    });
  }

  lines(): string[] {
    return this.screen.lines();
  }

  lastOutputAt(): number {
    return this.outputAt;
  }

  lastUserInputAt(): number {
    return this.userAt;
  }

  write(data: string): void {
    this.pty.write(data);
  }

  userInput(data: string): void {
    this.userAt = Date.now();
    if (this.held) this.held.push(data);
    else this.pty.write(data);
  }

  holdUserInput(hold: boolean): void {
    if (hold) {
      this.held ??= [];
      return;
    }
    const pending = this.held;
    this.held = null;
    if (pending?.length) this.pty.write(pending.join(""));
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows);
    this.pty.resize(cols, rows);
  }

  kill(signal?: string): void {
    this.pty.kill(signal);
  }
}
