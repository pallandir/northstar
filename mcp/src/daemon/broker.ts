import type { DeferralNotice, HandoffOutcome, TemplateId } from "@northstar/protocol";

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
  private listeners = new Set<(template: TemplateId) => void>();
  private queuedTemplate: TemplateId | null = null;
  private lastListenTime = 0;

  get currentVersion(): number {
    return this.version;
  }

  get lastPolledAt(): string | null {
    return this.lastPolled;
  }

  get lastPolledMs(): number {
    return this.lastPolledTime;
  }

  get listening(): boolean {
    return this.listeners.size > 0;
  }

  listenerSeenWithin(ms: number): boolean {
    return this.listening || (this.lastListenTime > 0 && Date.now() - this.lastListenTime < ms);
  }

  listen(timeoutMs: number, aborted: AbortSignal): Promise<{ template: TemplateId | null }> {
    this.lastListenTime = Date.now();
    if (this.queuedTemplate) {
      const template = this.queuedTemplate;
      this.queuedTemplate = null;
      return Promise.resolve({ template });
    }
    return new Promise((resolve) => {
      const done = (template: TemplateId | null) => {
        clearTimeout(timer);
        aborted.removeEventListener("abort", onAbort);
        this.listeners.delete(wake);
        this.lastListenTime = Date.now();
        resolve({ template });
      };
      const wake = (template: TemplateId) => done(template);
      const onAbort = () => done(null);
      const timer = setTimeout(() => done(null), timeoutMs);
      aborted.addEventListener("abort", onAbort);
      this.listeners.add(wake);
    });
  }

  signalHandoff(template: TemplateId): boolean {
    const [first] = this.listeners;
    if (first) {
      first(template);
      return true;
    }
    this.queuedTemplate = template;
    return false;
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
