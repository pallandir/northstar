import type { DeliveryTarget } from "../pty/deliver.js";
import type { TerminalDriver } from "./types.js";

export class TerminalTarget implements DeliveryTarget {
  private screen = "";
  private changedAt = Date.now();

  constructor(private readonly driver: TerminalDriver) {}

  async lines(): Promise<string[]> {
    const text = await this.driver.capture();
    if (text !== this.screen) {
      this.screen = text;
      this.changedAt = Date.now();
    }
    return text.split("\n");
  }

  lastOutputAt(): number {
    return this.changedAt;
  }

  lastUserInputAt(): number {
    return this.changedAt;
  }

  holdUserInput(_hold: boolean): void {}

  async write(data: string): Promise<void> {
    if (data === "\r") await this.driver.sendEnter();
    else await this.driver.sendText(data);
  }
}
