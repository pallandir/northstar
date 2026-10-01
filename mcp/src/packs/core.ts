import {
  type Canon,
  type CatalogEntry,
  type EntryKind,
  buildCatalog,
  findInCatalog,
  readEntry,
  renderHits,
} from "@northstar/canon";
import { z } from "zod";
import type { IngestStatus } from "../ingest-status.js";
import { inspectProject } from "../project.js";
import { PACK_NAMES, PACK_SUMMARIES, type PackName, type PackRegistry } from "./registry.js";
import { error, text } from "./util.js";

const packSchema = z.enum(PACK_NAMES);

const KINDS = ["ref", "rule", "archetype", "conflict"] as const satisfies readonly EntryKind[];
const STAGES = ["brief", "direction", "system", "compose", "critique", "polish"] as const;

export function registerCore(
  registry: PackRegistry,
  root: string,
  ingest: () => IngestStatus,
  canon: Canon,
): void {
  let catalog: CatalogEntry[] | undefined;
  const entries = () => {
    catalog ??= buildCatalog(canon);
    return catalog;
  };

  registry.register(
    "core",
    "canon_find",
    {
      description:
        "Search the design canon without loading it: reference sections, rules, archetypes and resolved conflicts. Returns ids with a one line summary and a token cost, within a small budget. Use it before reading anything, then call canon_read with an id. Plain language works, typos are corrected.",
      inputSchema: {
        query: z.string().min(2).max(200),
        kind: z.enum(KINDS).optional(),
        stage: z.enum(STAGES).optional(),
        limit: z.number().int().min(1).max(12).optional(),
        budget: z.number().int().min(100).max(3000).optional(),
      },
    },
    async ({ query, kind, stage, limit, budget }) => {
      const result = findInCatalog(entries(), canon, query, { kind, stage, limit, budget });
      if (!result.hits.length) {
        const topics = canon.references.map((r) => r.topic).join(", ");
        return text(`No match for "${query}". Try other words, or a topic: ${topics}.`);
      }
      return text(renderHits(result));
    },
  );

  registry.register(
    "core",
    "canon_read",
    {
      description:
        "Read one canon entry by id from canon_find: ref:<topic>#<section>, rule:<id>, arch:<id> or conflict:<id>. A topic id returns its outline with the cost of each section, not the whole reference. Pass full true only when you need the whole reference.",
      inputSchema: { id: z.string().min(3).max(120), full: z.boolean().optional() },
    },
    async ({ id, full }) => {
      try {
        const found = readEntry(entries(), id);
        if (full && found.kind === "ref" && !found.parent) {
          const reference = canon.references.find((r) => `ref:${r.topic}` === found.id);
          if (reference) return text(reference.body);
        }
        return text(`${found.id} (~${found.tokens}t)\n${found.body}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "core",
    "northstar_context",
    {
      description:
        "Call this first for any UI design work. Reports the detected stack, whether PRODUCT.md and DESIGN.md exist and are valid, the mode, the likely stage, what is still missing, and which tool packs are enabled.",
    },
    async () => {
      const state = inspectProject(root);
      const packs = PACK_NAMES.map((name) => ({
        name,
        enabled: registry.isActive(name),
        summary: PACK_SUMMARIES[name],
        tools: registry.toolsOf(name),
      }));
      const status = ingest();
      const channel =
        status.state === "on"
          ? { ingest: "on", port: status.port }
          : { ingest: "off", error: status.error };
      return text(JSON.stringify({ ...state, channel, packs }, null, 2));
    },
  );

  registry.register(
    "core",
    "enable_packs",
    {
      description:
        "Enable design tool packs for the current stage. Returns the newly available tools with their arguments. Packs: research, system, resolve, detect, critique.",
      inputSchema: { packs: z.array(packSchema).min(1) },
    },
    async ({ packs }) => {
      const added = registry.enable(packs as PackName[]);
      if (!added.length) return text("Those packs were already enabled.");
      const lines = added.map((name) => {
        const info = registry.describe(name);
        return `${name}(${info?.args.join(", ") ?? ""}): ${info?.description ?? ""}`;
      });
      return text(
        `Enabled ${added.length} tools. If your client does not refresh its tool list, use pack_call.\n${lines.join("\n")}`,
      );
    },
  );

  registry.register(
    "core",
    "pack_call",
    {
      description:
        "Call a tool from any pack by name, even when its pack is not enabled or your client does not refresh tool lists.",
      inputSchema: { tool: z.string(), args: z.record(z.unknown()).optional() },
    },
    async ({ tool, args }, extra) =>
      (await registry.call(tool, args, extra)) as { content: { type: "text"; text: string }[] },
  );
}
