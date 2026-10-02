import type { DeferralNotice, HandoffOutcome } from "@northstar/protocol";

const MAX_NOTICES = 20;

export class Broker {
  readonly startedAt = new Date().toISOString();
  readonly pid = process.pid;

  private version = 1;
  private lastPolled: string | null = null;
  private lastPolledTime = 0;
  private notices: DeferralNotice[] = [];
  private handoff: HandoffOutcome | null = null;
  private pollWaiters = new Set<() => void>();

  get currentVersion(): number {
    return this.version;
  }

  get lastPolledAt(): string | null {
    return this.lastPolled;
  }

  get lastPolledMs(): number {
    return this.lastPolledTime;
  }

  activeWithin(ms: number): boolean {
    return this.lastPolledTime > 0 && Date.now() - this.lastPolledTime < ms;
  }

  get pendingNotices(): DeferralNotice[] {
    return [...this.notices];
  }

  get lastHandoff(): HandoffOutcome | null {
    return this.handoff;
  }

  recordHandoff(outcome: HandoffOutcome): void {
    this.handoff = outcome;
  }

  markPolled(): void {
    this.lastPolledTime = Date.now();
    this.lastPolled = new Date(this.lastPolledTime).toISOString();
    for (const wake of this.pollWaiters) wake();
  }

  waitForPoll(since: number, timeoutMs: number): Promise<boolean> {
    if (this.lastPolledTime >= since) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (polled: boolean) => {
        clearTimeout(timer);
        this.pollWaiters.delete(check);
        resolve(polled);
      };
      const check = () => {
        if (this.lastPolledTime >= since) done(true);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.pollWaiters.add(check);
    });
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
