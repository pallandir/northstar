import type { DeferralNotice, HandoffOutcome, TemplateId } from "@northstar/protocol";

const MAX_NOTICES = 20;

export type HandoffSignal = "woken" | "queued" | "already-sent";

export class Broker {
  readonly startedAt = new Date().toISOString();
  readonly pid = process.pid;

  private version = 1;
  private lastPolled: string | null = null;
  private lastPolledTime = 0;
  private notices: DeferralNotice[] = [];
  private handoff: HandoffOutcome | null = null;
  private listeners = new Set<(template: TemplateId) => void>();
  private queuedTemplate: TemplateId | null = null;
  private lastListenTime = 0;
  private deliveredVersion = -1;

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
    if (aborted.aborted) return Promise.resolve({ template: null });
    if (this.queuedTemplate) {
      const template = this.queuedTemplate;
      this.queuedTemplate = null;
      this.deliveredVersion = this.version;
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

  signalHandoff(template: TemplateId): HandoffSignal {
    const [first] = this.listeners;
    if (first) {
      this.deliveredVersion = this.version;
      first(template);
      return "woken";
    }
    if (this.deliveredVersion === this.version) return "already-sent";
    this.queuedTemplate = template;
    return "queued";
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
