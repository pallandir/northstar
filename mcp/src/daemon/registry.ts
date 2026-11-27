import { mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import writeAtomic from "write-file-atomic";
import { stateDir } from "../lib/home.js";

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
  private roots: RootEntry[] = [];
  private readonly assistants = new Map<string, number>();

  constructor(private readonly home: string) {
    this.roots = this.loadRoots();
  }

  attachAssistant(root: string): () => void {
    this.assistants.set(root, (this.assistants.get(root) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.assistants.get(root) ?? 1) - 1;
      if (left === 0) this.assistants.delete(root);
      else this.assistants.set(root, left);
    };
  }

  hasAssistant(root: string): boolean {
    return this.assistants.has(root);
  }

  rememberRoot(root: string): void {
    const entry = { root, lastSeen: new Date().toISOString() };
    this.roots = [entry, ...this.roots.filter((r) => r.root !== root)].slice(0, MAX_ROOTS);
    this.write("projects.json", { roots: this.roots });
  }

  knownRoots(): string[] {
    return this.roots.filter((r) => isDirectory(r.root)).map((r) => r.root);
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
      throw new Error(
        `${path} is not readable (${(error as Error).message}). Delete it, then start Northstar again.`,
      );
    }
  }

  private write(name: string, body: unknown): void {
    const dir = stateDir(this.home);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeAtomic.sync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      throw new Error(
        `Northstar could not save ${join(dir, name)} (${(error as Error).message}). Check the folder is writable, then try again.`,
      );
    }
  }
}
