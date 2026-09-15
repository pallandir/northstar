import type { DeferralNotice } from "./types.js";

const MAX_NOTICES = 20;

export class Broker {
  readonly startedAt = new Date().toISOString();
  readonly pid = process.pid;

  private version = 1;
  private lastPolled: string | null = null;
  private notices: DeferralNotice[] = [];

  get currentVersion(): number {
    return this.version;
  }

  get lastPolledAt(): string | null {
    return this.lastPolled;
  }

  get pendingNotices(): DeferralNotice[] {
    return [...this.notices];
  }

  markPolled(): void {
    this.lastPolled = new Date().toISOString();
  }

  bump(): void {
    this.version += 1;
  }

  pushNotice(notice: DeferralNotice): void {
    this.notices = [notice, ...this.notices].slice(0, MAX_NOTICES);
    this.bump();
  }

  dismissNotice(commentId: string): void {
    this.notices = this.notices.filter((n) => n.commentId !== commentId);
    this.bump();
  }
}
