import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { SessionInfo, TemplateId } from "@northstar/protocol";
import { stateDir } from "../lib/home.js";
import type { DeliverOutcome } from "../pty/deliver.js";

export interface SessionHandle {
  info: SessionInfo;
  deliver(template: TemplateId): Promise<DeliverOutcome>;
}

const MAX_ROOTS = 20;

interface RootEntry {
  root: string;
  lastSeen: string;
}

export function canonicalRoot(path: string): string {
  return realpathSync.native(path);
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function projectName(root: string): string {
  return basename(root) || root;
}

export class Registry {
  private readonly sessions = new Map<string, SessionHandle>();
  private roots: RootEntry[] = [];

  constructor(
    private readonly home: string,
    private readonly log: (message: string) => void,
  ) {
    this.roots = this.loadRoots();
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((handle) => handle.info);
  }

  get(id: string): SessionHandle | undefined {
    return this.sessions.get(id);
  }

  add(handle: SessionHandle): void {
    this.sessions.set(handle.info.id, handle);
    this.rememberRoot(handle.info.root);
    this.persistSessions();
  }

  remove(id: string): void {
    if (this.sessions.delete(id)) this.persistSessions();
  }

  touch(id: string): void {
    const handle = this.sessions.get(id);
    if (handle) handle.info.lastActivityAt = new Date().toISOString();
  }

  bindRoot(ancestors: readonly number[], root: string): SessionInfo | null {
    for (const handle of this.sessions.values()) {
      if (ancestors.includes(handle.info.pid)) {
        handle.info.root = root;
        this.persistSessions();
        return handle.info;
      }
    }
    return null;
  }

  rememberRoot(root: string): void {
    const entry = { root, lastSeen: new Date().toISOString() };
    this.roots = [entry, ...this.roots.filter((r) => r.root !== root)].slice(0, MAX_ROOTS);
    this.write("projects.json", { roots: this.roots });
  }

  knownRoots(): string[] {
    const live = this.roots.filter((r) => isDirectory(r.root));
    for (const handle of this.sessions.values()) {
      if (!live.some((r) => r.root === handle.info.root)) {
        live.push({ root: handle.info.root, lastSeen: handle.info.lastActivityAt });
      }
    }
    return live.map((r) => r.root);
  }

  private loadRoots(): RootEntry[] {
    const path = join(stateDir(this.home), "projects.json");
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as { roots?: unknown };
      if (!Array.isArray(parsed.roots)) throw new Error("roots is not a list");
      return parsed.roots.filter(
        (entry): entry is RootEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RootEntry).root === "string" &&
          typeof (entry as RootEntry).lastSeen === "string",
      );
    } catch (error) {
      this.log(`ignoring unreadable ${path}: ${(error as Error).message}`);
      return [];
    }
  }

  private persistSessions(): void {
    this.write("sessions.json", { sessions: this.list() });
  }

  private write(name: string, body: unknown): void {
    const dir = stateDir(this.home);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, name);
      const staging = `${path}.${process.pid}.tmp`;
      writeFileSync(staging, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      renameSync(staging, path);
    } catch (error) {
      this.log(`could not write ${name}: ${(error as Error).message}`);
    }
  }
}
