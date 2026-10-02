import {
  DRAFT_FIX,
  type DraftCheck,
  type PostCommentsResponse,
  type Rejection,
  type StatusResponse,
  type actionParams,
  checkDrafts,
  pageKey,
} from "@northstar/protocol";
import type { z } from "zod";
import { loadSettings } from "../user-config.js";
import { readinessFor } from "./router.js";
import { badRequest } from "./rpc.js";
import { ASSISTANT_ACTIVE_MS } from "./sending.js";
import type { Workspace } from "./workspace.js";

type Params<K extends keyof typeof actionParams> = z.infer<(typeof actionParams)[K]>;

function noDraft(): Rejection {
  return {
    cid: null,
    field: "comment",
    error: "No comment was valid.",
    fix: DRAFT_FIX,
  };
}

export class CommentActions {
  constructor(
    private readonly workspace: Workspace,
    private readonly log: (message: string) => void,
  ) {}

  private pageParam(page: string): string {
    try {
      return pageKey(page);
    } catch {
      throw badRequest(
        "The page value is not a valid page key.",
        "Pass the page url, for example http://localhost:3000/users/1.",
      );
    }
  }

  list({ root, page }: Params<"comments.list">) {
    const canonical = this.workspace.requireRoot(root);
    return this.workspace
      .store(canonical)
      .list(undefined, page === undefined ? undefined : this.pageParam(page));
  }

  async add({ root, drafts }: Params<"comments.add">): Promise<PostCommentsResponse> {
    const canonical = this.workspace.requireRoot(root);
    const checks = checkDrafts(drafts);
    const valid = checks.filter(
      (c): c is DraftCheck & { draft: NonNullable<DraftCheck["draft"]> } => Boolean(c.draft),
    );
    const rejected: Rejection[] = checks.flatMap((c) => (c.rejection ? [c.rejection] : []));
    if (valid.length === 0) {
      this.log(`comments.rejected count=${rejected.length}`);
      return { ids: [], accepted: [], rejected: rejected.length ? rejected : [noDraft()] };
    }
    const outcomes = await this.workspace.store(canonical).ingestMany(valid.map((c) => c.draft));
    const accepted: PostCommentsResponse["accepted"] = [];
    let fresh = 0;
    outcomes.forEach((outcome, i) => {
      if (!outcome.ok) {
        rejected.push(outcome.rejection);
        return;
      }
      accepted.push({
        cid: (valid[i] as (typeof valid)[number]).draft.cid,
        id: outcome.comment.id,
      });
      if (!outcome.duplicate) fresh += 1;
    });
    if (fresh > 0) this.workspace.broker(canonical).bump();
    this.log(`comments.ingested new=${fresh} rejected=${rejected.length}`);
    return { ids: accepted.map((a) => a.id), accepted, rejected };
  }

  async clear({ root, page, all }: Params<"comments.clear">): Promise<{ removed: number }> {
    const canonical = this.workspace.requireRoot(root);
    if ((page === undefined) === !all) {
      throw badRequest(
        "Pass either page or all, not both and not neither.",
        "Update the Northstar extension.",
      );
    }
    const removed = await this.workspace
      .store(canonical)
      .clear(all ? undefined : this.pageParam(page as string));
    if (removed > 0) this.workspace.broker(canonical).bump();
    this.log(`comments.cleared count=${removed}`);
    return { removed };
  }

  async reopen({ root, id, note }: Params<"comments.reopen">): Promise<Record<string, never>> {
    const canonical = this.workspace.requireRoot(root);
    const outcome = await this.workspace.store(canonical).reopenWithNote(id, note);
    if (!outcome) {
      throw badRequest(
        "That comment no longer exists.",
        "Refresh the page to see the current comments.",
      );
    }
    if (!outcome.changed) {
      throw badRequest(
        "That comment is already open.",
        "Refresh the page to see its current state.",
      );
    }
    this.workspace.broker(canonical).bump();
    return {};
  }

  dismissNotice({ root, commentId }: Params<"notices.dismiss">): Record<string, never> {
    this.workspace.broker(this.workspace.requireRoot(root)).dismissNotice(commentId);
    return {};
  }

  async status({ root }: Params<"status.get">): Promise<StatusResponse> {
    const canonical = this.workspace.requireRoot(root);
    const broker = this.workspace.broker(canonical);
    const settings = loadSettings(this.workspace.home);
    return {
      notices: broker.pendingNotices,
      readiness: readinessFor(this.workspace.registry.list(), {
        root: canonical,
        preferredAgent: settings.preferredAgent,
        assistantConnected: this.workspace.registry.hasAssistant(canonical),
        assistantWorking: broker.activeWithin(ASSISTANT_ACTIVE_MS),
      }),
      open: (await this.workspace.store(canonical).list("open")).length,
      lastPolledAt: broker.lastPolledAt,
      handoff: broker.lastHandoff,
    };
  }
}
