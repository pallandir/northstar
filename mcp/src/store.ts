import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  Comment,
  CommentStatus,
  DeferredComment,
  IncomingComment,
  Operation,
  OperationType,
} from "./types.js";

// Confine a source location's path to the project root so a crafted page cannot
// steer the AI assistant toward arbitrary files outside the project.
function confineSourcePath(
  source: import("./types.js").SourceLocation | null,
  root: string,
): import("./types.js").SourceLocation | null {
  if (!source) return null;
  const normalized = isAbsolute(source.path) ? resolve(source.path) : resolve(root, source.path);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (normalized !== root && !normalized.startsWith(rootWithSep)) return null;
  return source;
}

const STORE_DIR = ".northstar";
const STORE_FILE = join(STORE_DIR, "design-comments.md");
const STORE_JSON = join(STORE_DIR, "design-comments.json");
const SHOTS_DIR = join(STORE_DIR, "design-shots");
const DEFERRED_FILE = join(STORE_DIR, "northstar-deferred.md");

export class CommentStore {
  private readonly storeRoot: string;
  private readonly storePath: string;
  private readonly storeJsonPath: string;
  private readonly shotsPath: string;
  private readonly deferredPath: string;
  private readonly storeDir: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private storeDirInitialized = false;

  constructor(root: string) {
    this.storeRoot = root;
    this.storeDir = join(root, STORE_DIR);
    this.storePath = join(root, STORE_FILE);
    this.storeJsonPath = join(root, STORE_JSON);
    this.shotsPath = join(root, SHOTS_DIR);
    this.deferredPath = join(root, DEFERRED_FILE);
  }

  get root(): string {
    return this.storeRoot;
  }

  get commentsPath(): string {
    return this.storeJsonPath;
  }

  private async initStoreDir(): Promise<void> {
    if (this.storeDirInitialized) return;
    this.storeDirInitialized = true;
    await mkdir(this.storeDir, { recursive: true });
    const gitignore = join(this.storeDir, ".gitignore");
    try {
      await access(gitignore);
    } catch {
      await writeFile(gitignore, "*\n", "utf8");
    }
  }

  async list(status?: CommentStatus): Promise<Comment[]> {
    const all = await this.read();
    return status ? all.filter((c) => c.status === status) : all;
  }

  async get(id: string): Promise<Comment | undefined> {
    return (await this.read()).find((c) => c.id === id);
  }

  async add(incoming: IncomingComment, projectRoot?: string): Promise<Comment> {
    const id = `c-${randomUUID().slice(0, 8)}`;
    const screenshot = incoming.screenshotDataUrl
      ? await this.saveShot(id, incoming.screenshotDataUrl)
      : null;
    const root = projectRoot ?? this.storeRoot;
    const safeSource = confineSourcePath(incoming.source ?? null, root);
    const comment: Comment = {
      id,
      createdAt: new Date().toISOString(),
      comment: incoming.comment,
      operation: incoming.operation,
      operator: incoming.operator,
      url: incoming.url,
      metadata: incoming.metadata,
      status: "open",
      source: safeSource,
      screenshot,
      planFirst: incoming.planFirst ?? false,
    };
    return this.enqueue(async () => {
      const comments = await this.read();
      comments.push(comment);
      await this.write(comments);
      return comment;
    });
  }

  async setStatus(id: string, status: CommentStatus): Promise<Comment | undefined> {
    return this.enqueue(async () => {
      const comments = await this.read();
      const comment = comments.find((c) => c.id === id);
      if (!comment) return undefined;
      comment.status = status;
      await this.write(comments);
      return comment;
    });
  }

  async reopenWithNote(id: string, note?: string): Promise<Comment | undefined> {
    return this.enqueue(async () => {
      const comments = await this.read();
      const comment = comments.find((c) => c.id === id);
      if (!comment) return undefined;
      comment.status = "open";
      if (note) comment.comment = `${comment.comment}\n\n${note}`;
      await this.write(comments);
      return comment;
    });
  }

  async clearResolved(): Promise<number> {
    return this.enqueue(async () => {
      const comments = await this.read();
      const kept = comments.filter((c) => c.status === "open");
      await this.write(kept);
      return comments.length - kept.length;
    });
  }

  async clear(url?: string): Promise<number> {
    return this.enqueue(async () => {
      const comments = await this.read();
      const kept = url ? comments.filter((c) => c.url !== url) : [];
      await this.write(kept);
      return comments.length - kept.length;
    });
  }

  async listDeferred(): Promise<DeferredComment[]> {
    const raw = await readTextFile(this.deferredPath);
    return raw === null ? [] : parseDeferred(raw);
  }

  async addDeferred(
    origin: Comment,
    reason: string,
    flaggedBy: "user" | "assistant",
    category: "needs-plan" | "feedback" = "needs-plan",
  ): Promise<DeferredComment> {
    return this.enqueue(async () => {
      const existing = await this.listDeferred();
      const found = existing.find((d) => d.id === origin.id);
      if (found) return found;
      const entry: DeferredComment = {
        id: origin.id,
        createdAt: new Date().toISOString(),
        page: origin.metadata.page,
        operationType: origin.operation.type,
        comment: origin.comment,
        reason,
        flaggedBy,
        category,
      };
      existing.push(entry);
      await writeFileAtomic(this.deferredPath, serializeDeferred(existing));
      return entry;
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async saveShot(id: string, dataUrl: string): Promise<string> {
    await this.initStoreDir();
    await mkdir(this.shotsPath, { recursive: true });
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const file = join(this.shotsPath, `${id}.png`);
    await writeFile(file, Buffer.from(base64, "base64"));
    return relative(this.root, file);
  }

  private async read(): Promise<Comment[]> {
    const jsonRaw = await readTextFile(this.storeJsonPath);
    if (jsonRaw !== null) {
      try {
        return JSON.parse(jsonRaw) as Comment[];
      } catch {
        return [];
      }
    }
    const mdRaw = await readTextFile(this.storePath);
    return mdRaw === null ? [] : parse(mdRaw);
  }

  private async write(comments: Comment[]): Promise<void> {
    await this.initStoreDir();
    await writeFileAtomic(this.storeJsonPath, JSON.stringify(comments, null, 2));
    await writeFileAtomic(this.storePath, serialize(comments));
  }
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}

function serialize(comments: Comment[]): string {
  const blocks = comments.map((c) => {
    const lines = [
      `## [${c.status}] ${c.id} · ${c.metadata.page} · ${c.operation.type}`,
      `> ${c.comment}`,
      "",
    ];
    if (c.screenshot) lines.push(`![${c.id}](${c.screenshot})`, "");
    const op = c.operation;
    if (op.type !== "comment") {
      const prop = op.property ? `${op.property}: ` : "";
      lines.push(
        `- operation: ${op.type} ${prop}${JSON.stringify(op.from)} -> ${JSON.stringify(op.to)}`,
      );
    }
    if (c.source) {
      lines.push(
        `- source: ${c.source.path}:${c.source.line}:${c.source.column} (${c.source.via})`,
      );
    }
    if (c.planFirst) lines.push("- planfirst: true");
    lines.push(
      `- operator: ${c.operator}`,
      `- elementtext: ${JSON.stringify(c.metadata.elementText)}`,
      `- viewport: ${c.metadata.viewport.w}x${c.metadata.viewport.h}`,
      `- url: ${c.url}`,
      `- created: ${c.createdAt}`,
    );
    return lines.join("\n");
  });
  return `# Design comments\n\n${blocks.join("\n\n")}\n`;
}

const HEADING = /^## \[(open|resolved|wontfix)\] (\S+) · (.+?) · (comment|style|text)$/;
const KV = /^- (\w+): (.+)$/;
const SOURCE = /^(.+):(\d+):(\d+) \((.+)\)$/;

interface Draft {
  kv: Record<string, string>;
  status: CommentStatus;
  id: string;
  page: string;
  operationType: OperationType;
  comment?: string;
  screenshot?: string;
  operation?: Operation;
}

function parse(raw: string): Comment[] {
  const comments: Comment[] = [];
  let current: Draft | null = null;

  const flush = () => {
    if (!current) return;
    const kv = current.kv;
    const source = kv.source?.match(SOURCE);
    const viewport = parseViewport(kv.viewport);
    comments.push({
      id: current.id,
      createdAt: kv.created ?? new Date(0).toISOString(),
      comment: current.comment ?? "",
      operation: current.operation ?? {
        type: current.operationType,
        property: null,
        from: null,
        to: null,
      },
      operator: kv.operator ?? "",
      url: kv.url ?? "",
      metadata: {
        page: current.page,
        viewport,
        elementText: safeJson(kv.elementtext) ?? "",
      },
      status: current.status,
      source: source
        ? { path: source[1], line: Number(source[2]), column: Number(source[3]), via: source[4] }
        : null,
      screenshot: current.screenshot ?? null,
      planFirst: kv.planfirst === "true",
    });
  };

  for (const line of raw.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      current = {
        kv: {},
        status: heading[1] as CommentStatus,
        id: heading[2],
        page: heading[3],
        operationType: (heading[4] as OperationType) ?? "comment",
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("> ")) {
      current.comment = line.slice(2);
      continue;
    }
    const shot = line.match(/^!\[.*\]\((.+)\)$/);
    if (shot) {
      current.screenshot = shot[1];
      continue;
    }
    if (line.startsWith("- operation: ")) {
      current.operation = parseOperation(line.slice("- operation: ".length));
      continue;
    }
    const kv = line.match(KV);
    if (kv) current.kv[kv[1]] = kv[2];
  }
  flush();
  return comments;
}

function parseOperation(body: string): Operation {
  const spaceIdx = body.indexOf(" ");
  if (spaceIdx < 0) {
    return { type: body as OperationType, property: null, from: null, to: null };
  }
  const type = body.slice(0, spaceIdx) as OperationType;
  const rest = body.slice(spaceIdx + 1);

  if (type === "text") {
    const arrowIdx = rest.indexOf('" -> "');
    if (arrowIdx >= 0) {
      const fromJson = rest.slice(0, arrowIdx + 1);
      const toJson = `"${rest.slice(arrowIdx + 6)}`;
      return {
        type: "text",
        property: null,
        from: safeJson(fromJson) ?? fromJson,
        to: safeJson(toJson) ?? toJson,
      };
    }
  }

  if (type === "style") {
    const colonIdx = rest.indexOf(': "');
    if (colonIdx >= 0) {
      const property = rest.slice(0, colonIdx);
      const remaining = rest.slice(colonIdx + 2);
      const arrowIdx = remaining.indexOf('" -> "');
      if (arrowIdx >= 0) {
        const fromJson = remaining.slice(0, arrowIdx + 1);
        const toJson = `"${remaining.slice(arrowIdx + 6)}`;
        return {
          type: "style",
          property,
          from: safeJson(fromJson) ?? fromJson,
          to: safeJson(toJson) ?? toJson,
        };
      }
    }
  }

  return { type, property: null, from: null, to: null };
}

function parseViewport(value?: string): { w: number; h: number } {
  const match = value?.match(/^(\d+)x(\d+)$/);
  return match ? { w: Number(match[1]), h: Number(match[2]) } : { w: 0, h: 0 };
}

function safeJson(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function serializeDeferred(entries: DeferredComment[]): string {
  const blocks = entries.map((d) => {
    const lines = [
      `## [deferred] ${d.id} · ${d.page} · ${d.operationType}`,
      `> ${d.comment}`,
      "",
      `- reason: ${d.reason}`,
      `- flaggedby: ${d.flaggedBy}`,
      `- category: ${d.category}`,
      `- created: ${d.createdAt}`,
    ];
    return lines.join("\n");
  });
  return `# Deferred comments\n\n${blocks.join("\n\n")}\n`;
}

const DEFERRED_HEADING = /^## \[deferred\] (\S+) · (.+?) · (comment|style|text)$/;

function parseDeferred(raw: string): DeferredComment[] {
  const entries: DeferredComment[] = [];
  let current: (Partial<DeferredComment> & { kv: Record<string, string> }) | null = null;

  const flush = () => {
    if (!current) return;
    entries.push({
      id: current.id ?? "",
      createdAt: current.kv.created ?? new Date(0).toISOString(),
      page: current.page ?? "",
      operationType: (current.operationType ?? "comment") as OperationType,
      comment: current.comment ?? "",
      reason: current.kv.reason ?? "",
      flaggedBy: (current.kv.flaggedby === "user" ? "user" : "assistant") as "user" | "assistant",
      category: (current.kv.category === "feedback" ? "feedback" : "needs-plan") as
        | "needs-plan"
        | "feedback",
    });
  };

  for (const line of raw.split("\n")) {
    const heading = line.match(DEFERRED_HEADING);
    if (heading) {
      flush();
      current = {
        kv: {},
        id: heading[1],
        page: heading[2],
        operationType: heading[3] as OperationType,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("> ")) {
      current.comment = line.slice(2);
      continue;
    }
    const kv = line.match(KV);
    if (kv) current.kv[kv[1]] = kv[2];
  }
  flush();
  return entries;
}
