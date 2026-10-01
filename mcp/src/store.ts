import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DRAFT_FIX, type Rejection, pageKey } from "@northstar/protocol";
import { resolveInside } from "./lib/paths.js";
import type { Comment, CommentStatus, DeferredComment, Draft, Resolution } from "./types.js";

const STORE_DIR = ".northstar";
const STORE_JSON = join(STORE_DIR, "design-comments.json");
const STORE_MIRROR = join(STORE_DIR, "design-comments.md");
const SHOTS_DIR = join(STORE_DIR, "design-shots");
const DEFERRED_JSON = join(STORE_DIR, "northstar-deferred.json");
const DEFERRED_MIRROR = join(STORE_DIR, "northstar-deferred.md");
const LOCK_DIR = join(STORE_DIR, "store.lock");

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 25;

const STATUSES: readonly string[] = ["open", "in_progress", "resolved", "wontfix"];
const SHOT_EXTENSIONS: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  webp: "webp",
};

type IngestOutcome =
  | { ok: true; comment: Comment; duplicate: boolean }
  | { ok: false; rejection: Rejection };

interface UpdateOutcome {
  comment: Comment;
  changed: boolean;
}

interface Snapshot<T> {
  signature: string;
  items: T[];
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredComment(value: unknown): value is Comment {
  return (
    isRecord(value) && typeof value.id === "string" && STATUSES.includes(value.status as string)
  );
}

function isStoredDeferral(value: unknown): value is DeferredComment {
  return isRecord(value) && typeof value.id === "string" && typeof value.reason === "string";
}

export class CommentStore {
  private readonly storeRoot: string;
  private readonly storeDir: string;
  private readonly storePath: string;
  private readonly mirrorPath: string;
  private readonly shotsPath: string;
  private readonly deferredPath: string;
  private readonly deferredMirrorPath: string;
  private readonly lockPath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private storeDirInitialized = false;
  private commentsCache: Snapshot<Comment> | null = null;
  private deferredCache: Snapshot<DeferredComment> | null = null;
  private readonly backups = new Map<string, string>();

  constructor(root: string) {
    this.storeRoot = root;
    this.storeDir = join(root, STORE_DIR);
    this.storePath = join(root, STORE_JSON);
    this.mirrorPath = join(root, STORE_MIRROR);
    this.shotsPath = join(root, SHOTS_DIR);
    this.deferredPath = join(root, DEFERRED_JSON);
    this.deferredMirrorPath = join(root, DEFERRED_MIRROR);
    this.lockPath = join(root, LOCK_DIR);
  }

  get root(): string {
    return this.storeRoot;
  }

  get commentsPath(): string {
    return this.storePath;
  }

  get deferredFile(): string {
    return this.deferredPath;
  }

  async list(status?: CommentStatus, page?: string): Promise<Comment[]> {
    const all = await this.readComments();
    const key = page === undefined ? undefined : pageKey(page);
    return all.filter(
      (c) => (!status || c.status === status) && (key === undefined || pageKey(c.url) === key),
    );
  }

  async get(id: string): Promise<Comment | undefined> {
    return (await this.readComments()).find((c) => c.id === id);
  }

  async add(draft: Draft): Promise<Comment> {
    return (await this.ingest(draft)).comment;
  }

  async ingest(draft: Draft): Promise<{ comment: Comment; duplicate: boolean }> {
    const [outcome] = await this.ingestMany([draft]);
    if (!outcome?.ok) throw new Error(outcome?.rejection.error ?? "The comment was not stored.");
    return outcome;
  }

  async ingestMany(drafts: Draft[]): Promise<IngestOutcome[]> {
    return this.transact(async () => {
      const comments = await this.readComments(true);
      const savedShots: string[] = [];
      const outcomes: IngestOutcome[] = [];
      let added = 0;
      try {
        for (const draft of drafts) {
          const existing = comments.find((c) => c.cid === draft.cid);
          if (existing) {
            outcomes.push({ ok: true, comment: existing, duplicate: true });
            continue;
          }
          const rejection = this.confineSource(draft);
          if (rejection) {
            outcomes.push({ ok: false, rejection });
            continue;
          }
          const id = `c-${randomUUID().slice(0, 8)}`;
          const screenshot = draft.screenshotDataUrl
            ? await this.saveShot(id, draft.screenshotDataUrl)
            : null;
          if (screenshot) savedShots.push(resolve(this.storeRoot, screenshot));
          const comment = buildComment(id, draft, screenshot, this.relativeSource(draft));
          comments.push(comment);
          outcomes.push({ ok: true, comment, duplicate: false });
          added += 1;
        }
        if (added > 0) await this.writeComments(comments);
      } catch (error) {
        for (const file of savedShots) await rm(file, { force: true });
        throw error;
      }
      return outcomes;
    });
  }

  private confineSource(draft: Draft): Rejection | null {
    if (!draft.source) return null;
    try {
      resolveInside(this.storeRoot, draft.source.path);
      return null;
    } catch (error) {
      return {
        cid: draft.cid,
        field: "source.path",
        error: `The source.path field points outside the project: ${(error as Error).message}.`,
        fix: DRAFT_FIX,
      };
    }
  }

  private relativeSource(draft: Draft): Comment["source"] {
    if (!draft.source) return null;
    return { ...draft.source, path: resolveInside(this.storeRoot, draft.source.path) };
  }

  async update(
    id: string,
    status: CommentStatus,
    resolution?: { note?: string; files?: string[] },
  ): Promise<UpdateOutcome | undefined> {
    return this.transact(async () => {
      const comments = await this.readComments(true);
      const comment = comments.find((c) => c.id === id);
      if (!comment) return undefined;
      const finished = status === "resolved" || status === "wontfix";
      const entry: Resolution | undefined = finished
        ? {
            by: "agent",
            note: resolution?.note ?? null,
            files: resolution?.files ?? [],
            at: new Date().toISOString(),
          }
        : undefined;
      const changed =
        comment.status !== status ||
        (entry !== undefined &&
          (comment.resolution?.note !== entry.note ||
            comment.resolution?.files.join("\n") !== entry.files.join("\n")));
      if (!changed) return { comment, changed: false };
      comment.status = status;
      if (entry) comment.resolution = entry;
      else comment.resolution = undefined;
      await this.writeComments(comments);
      return { comment, changed: true };
    });
  }

  async setStatus(
    id: string,
    status: CommentStatus,
    resolution?: { note?: string; files?: string[] },
  ): Promise<Comment | undefined> {
    return (await this.update(id, status, resolution))?.comment;
  }

  async claim(id: string): Promise<{ comment: Comment; claimed: boolean } | undefined> {
    return this.transact(async () => {
      const comments = await this.readComments(true);
      const comment = comments.find((c) => c.id === id);
      if (!comment) return undefined;
      if (comment.status !== "open") return { comment, claimed: false };
      comment.status = "in_progress";
      await this.writeComments(comments);
      return { comment, claimed: true };
    });
  }

  async reopenWithNote(id: string, note?: string): Promise<UpdateOutcome | undefined> {
    return this.transact(async () => {
      const comments = await this.readComments(true);
      const comment = comments.find((c) => c.id === id);
      if (!comment) return undefined;
      if (comment.status === "open") return { comment, changed: false };
      comment.status = "open";
      comment.resolution = undefined;
      if (note) comment.comment = `${comment.comment}\n\n${note}`;
      await this.writeComments(comments);
      return { comment, changed: true };
    });
  }

  async clearResolved(): Promise<number> {
    return this.removeWhere((c) => c.status === "resolved" || c.status === "wontfix");
  }

  async clear(page?: string): Promise<number> {
    const key = page === undefined ? undefined : pageKey(page);
    return this.removeWhere((c) => key === undefined || pageKey(c.url) === key);
  }

  async listDeferred(): Promise<DeferredComment[]> {
    return this.readDeferred();
  }

  async addDeferred(
    origin: Comment,
    reason: string,
    flaggedBy: "user" | "assistant",
    category: "needs-plan" | "feedback" = "needs-plan",
  ): Promise<DeferredComment> {
    return this.transact(async () => {
      const existing = [...(await this.readDeferred())];
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
      await this.writeDeferred(existing);
      return entry;
    });
  }

  private async removeWhere(predicate: (comment: Comment) => boolean): Promise<number> {
    return this.transact(async () => {
      const comments = await this.readComments(true);
      const kept = comments.filter((c) => !predicate(c));
      const removed = comments.filter((c) => predicate(c));
      if (removed.length === 0) return 0;
      await this.writeComments(kept);
      await this.removeShots(removed);
      return removed.length;
    });
  }

  private transact<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(() => this.withFileLock(fn));
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async withFileLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.initStoreDir();
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        await mkdir(this.lockPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const held = await stat(this.lockPath).then(
        (info) => info,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        await rm(this.lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Another Northstar process is writing the comment store at ${this.storeDir}. Wait a moment and try again, or delete ${this.lockPath} if no agent session is running.`,
        );
      }
      await sleep(LOCK_RETRY_MS);
    }
    try {
      return await fn();
    } finally {
      await rm(this.lockPath, { recursive: true, force: true });
    }
  }

  private async initStoreDir(): Promise<void> {
    if (this.storeDirInitialized) return;
    await mkdir(this.storeDir, { recursive: true });
    const gitignore = join(this.storeDir, ".gitignore");
    try {
      await writeFile(gitignore, "*\n", { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    this.storeDirInitialized = true;
  }

  private async saveShot(id: string, dataUrl: string): Promise<string> {
    const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    const extension = SHOT_EXTENSIONS[match?.[1] ?? ""];
    if (!match || !extension) throw new Error("The screenshot is not a png, jpeg or webp image.");
    await mkdir(this.shotsPath, { recursive: true });
    const file = join(this.shotsPath, `${id}.${extension}`);
    await writeFileAtomic(file, Buffer.from(match[2] as string, "base64"));
    return relative(this.root, file);
  }

  private async removeShots(removed: Comment[]): Promise<void> {
    for (const comment of removed) {
      if (!comment.screenshot) continue;
      const file = resolve(this.storeRoot, comment.screenshot);
      if (!file.startsWith(this.shotsPath + sep)) {
        throw new Error(
          `The comment store lists a screenshot outside ${this.shotsPath}: ${comment.screenshot}. Remove that entry from ${this.storePath}.`,
        );
      }
      await rm(file, { force: true });
    }
  }

  private async readComments(fresh = false): Promise<Comment[]> {
    const items = await this.readList(
      this.storePath,
      "comment store",
      isStoredComment,
      this.commentsCache,
      (snapshot) => {
        this.commentsCache = snapshot;
      },
    );
    return fresh ? structuredClone(items) : items;
  }

  private async readDeferred(): Promise<DeferredComment[]> {
    return this.readList(
      this.deferredPath,
      "deferred list",
      isStoredDeferral,
      this.deferredCache,
      (snapshot) => {
        this.deferredCache = snapshot;
      },
    );
  }

  private async readList<T>(
    path: string,
    label: string,
    guard: (value: unknown) => value is T,
    cache: Snapshot<T> | null,
    remember: (snapshot: Snapshot<T>) => void,
  ): Promise<T[]> {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const signature = signatureOf(info);
    if (cache?.signature === signature) return cache.items;
    const raw = await readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw await this.corrupt(path, label, signature, (error as Error).message);
    }
    if (!Array.isArray(parsed) || !parsed.every(guard)) {
      throw await this.corrupt(path, label, signature, "it is not a list of valid entries");
    }
    remember({ signature, items: parsed });
    return parsed;
  }

  private async corrupt(path: string, label: string, signature: string, cause: string) {
    const key = `${path}:${signature}`;
    let backup = this.backups.get(key);
    if (!backup) {
      backup = `${path}.bak-${Date.now()}`;
      await copyFile(path, backup);
      this.backups.set(key, backup);
    }
    return new Error(
      `The ${label} ${path} is corrupt (${cause}). A copy was saved to ${backup}. Fix the file or delete it, then try again.`,
    );
  }

  private async writeComments(comments: Comment[]): Promise<void> {
    await this.initStoreDir();
    await writeFileAtomic(this.storePath, JSON.stringify(comments, null, 2));
    this.commentsCache = {
      signature: signatureOf(await stat(this.storePath)),
      items: comments,
    };
    await writeFileAtomic(this.mirrorPath, serializeComments(comments));
  }

  private async writeDeferred(entries: DeferredComment[]): Promise<void> {
    await this.initStoreDir();
    await writeFileAtomic(this.deferredPath, JSON.stringify(entries, null, 2));
    this.deferredCache = {
      signature: signatureOf(await stat(this.deferredPath)),
      items: entries,
    };
    await writeFileAtomic(this.deferredMirrorPath, serializeDeferred(entries));
  }
}

function signatureOf(info: {
  mtimeMs: number | bigint;
  size: number | bigint;
  ino: number | bigint;
}): string {
  return `${info.mtimeMs}:${info.size}:${info.ino}`;
}

function buildComment(
  id: string,
  draft: Draft,
  screenshot: string | null,
  source: Comment["source"],
): Comment {
  const comment: Comment = {
    id,
    createdAt: new Date().toISOString(),
    cid: draft.cid,
    comment: draft.comment,
    operation: draft.operation,
    operator: draft.operator,
    url: draft.url,
    metadata: draft.metadata,
    status: "open",
    source,
    component: draft.component ?? null,
    route: draft.route ?? null,
    target: draft.target ?? null,
    screenshot,
    attachScreenshot: draft.attachScreenshot ?? false,
    planFirst: draft.planFirst ?? false,
  };
  if (draft.schemaVersion) comment.schemaVersion = draft.schemaVersion;
  if (draft.intent) comment.intent = draft.intent;
  if (draft.locate) comment.locate = draft.locate;
  if (draft.page) comment.page = draft.page;
  if (draft.element) comment.element = draft.element;
  return comment;
}

async function writeFileAtomic(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temp, contents);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function serializeComments(comments: Comment[]): string {
  const blocks = comments.map((c) => {
    const lines = [
      `## [${c.status}] ${c.id} · ${c.metadata.page} · ${c.operation.type}`,
      `> ${c.comment.replace(/\n/g, "\n> ")}`,
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

function serializeDeferred(entries: DeferredComment[]): string {
  const blocks = entries.map((d) =>
    [
      `## [deferred] ${d.id} · ${d.page} · ${d.operationType}`,
      `> ${d.comment.replace(/\n/g, "\n> ")}`,
      "",
      `- reason: ${d.reason}`,
      `- flaggedby: ${d.flaggedBy}`,
      `- category: ${d.category}`,
      `- created: ${d.createdAt}`,
    ].join("\n"),
  );
  return `# Deferred comments\n\n${blocks.join("\n\n")}\n`;
}
