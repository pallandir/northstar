import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  type ProjectInfo,
  type ProjectResolution,
  SourcePathError,
  type actionParams,
  sanitizeSourcePath,
} from "@northstar/protocol";
import type { z } from "zod";
import { CommentStore } from "../store.js";
import { loadSettings } from "../user-config.js";
import { Broker } from "./broker.js";
import { Registry, canonicalRoot, isDirectory, projectName } from "./registry.js";
import { RpcError, badRequest } from "./rpc.js";

const MAX_OWNS_PATHS = 20;

async function isFileUnder(root: string, relative: string): Promise<boolean> {
  let resolved: string;
  try {
    resolved = await realpath(join(root, relative));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!resolved.startsWith(`${root}${sep}`)) return false;
  return (await stat(resolved)).isFile();
}

function pageWithoutScheme(page: string): string | null {
  try {
    const url = new URL(page);
    return `${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

export class Workspace {
  readonly registry: Registry;
  private readonly brokers = new Map<string, Broker>();
  private readonly stores = new Map<string, CommentStore>();

  constructor(
    readonly home: string,
    log: (message: string) => void,
  ) {
    this.registry = new Registry(home, log);
  }

  broker(root: string): Broker {
    let broker = this.brokers.get(root);
    if (!broker) {
      broker = new Broker();
      this.brokers.set(root, broker);
    }
    return broker;
  }

  store(root: string): CommentStore {
    let store = this.stores.get(root);
    if (!store) {
      store = new CommentStore(root);
      this.stores.set(root, store);
    }
    return store;
  }

  allRoots(): string[] {
    const roots = new Set(this.registry.knownRoots());
    const settings = loadSettings(this.home);
    for (const directory of Object.values(settings.projects)) {
      if (isDirectory(directory)) roots.add(canonicalRoot(directory));
    }
    return [...roots];
  }

  requireRoot(root: string): string {
    let canonical: string;
    try {
      canonical = canonicalRoot(root);
    } catch {
      throw new RpcError(
        "NO_PROJECT",
        `Northstar can not read the project ${root}.`,
        "Start your agent in that project, then try again.",
      );
    }
    if (!this.allRoots().includes(canonical)) {
      throw new RpcError(
        "NO_PROJECT",
        `Northstar does not know the project ${canonical}.`,
        "Start your agent in that project, or map it in northstar config.",
      );
    }
    return canonical;
  }

  projects(): ProjectInfo[] {
    const sessions = this.registry.list();
    return this.allRoots().map((root) => ({
      root,
      name: projectName(root),
      sessions: sessions.filter((s) => s.root === root && s.kind === "interactive").length,
    }));
  }

  async resolveProject(
    params: z.infer<(typeof actionParams)["project.resolve"]>,
  ): Promise<ProjectResolution> {
    const owners: ProjectResolution["owners"] = [];
    if (params.paths.length > MAX_OWNS_PATHS) {
      throw badRequest(
        `The paths field holds at most ${MAX_OWNS_PATHS} source paths.`,
        "Update the Northstar extension.",
      );
    }
    for (const root of this.allRoots()) {
      let matches = 0;
      for (const raw of params.paths) {
        let relative: string;
        try {
          relative = sanitizeSourcePath(raw, root);
        } catch (error) {
          if (error instanceof SourcePathError) {
            throw badRequest(
              `A source path was refused, ${error.message}.`,
              "Update the Northstar extension.",
            );
          }
          throw error;
        }
        if (await isFileUnder(root, relative)) matches += 1;
      }
      owners.push({ root, matches, depth: root.split(sep).length });
    }
    return { owners, mapped: this.mappedRoot(params.page) };
  }

  private mappedRoot(page: string | undefined): string | null {
    if (page === undefined) return null;
    const plain = pageWithoutScheme(page);
    if (plain === null) return null;
    const settings = loadSettings(this.home);
    const keys = Object.keys(settings.projects).sort((a, b) => b.length - a.length);
    const key = keys.find((k) => plain === k || plain.startsWith(`${k}/`));
    if (key === undefined) return null;
    const directory = settings.projects[key] as string;
    return isDirectory(directory) ? canonicalRoot(directory) : null;
  }
}
