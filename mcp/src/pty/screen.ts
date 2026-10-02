import headless from "@xterm/headless";

const SCROLLBACK = 200;

export class Screen {
  private readonly terminal: InstanceType<typeof headless.Terminal>;

  constructor(cols: number, rows: number) {
    this.terminal = new headless.Terminal({
      cols,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  settled(): Promise<void> {
    return new Promise((resolve) => this.terminal.write("", resolve));
  }

  lines(): string[] {
    const buffer = this.terminal.buffer.active;
    const out: string[] = [];
    for (let row = 0; row < this.terminal.rows; row += 1) {
      out.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    }
    return out;
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
