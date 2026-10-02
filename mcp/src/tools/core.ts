import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import type { BridgeStatus } from "../daemon/link.js";
import { browserState } from "../page/browser.js";
import { LoopStore } from "../page/loop.js";
import { inspectProject } from "../project.js";
import { error, text } from "./util.js";

const KINDS = ["ref", "rule", "archetype", "conflict"] as const satisfies readonly EntryKind[];
const STAGES = ["brief", "direction", "system", "compose", "critique", "polish"] as const;

export function registerCore(
  server: McpServer,
  root: string,
  bridge: () => BridgeStatus,
  canon: Canon,
): void {
  let catalog: CatalogEntry[] | undefined;
  const entries = () => {
    catalog ??= buildCatalog(canon);
    return catalog;
  };

  server.registerTool(
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

  server.registerTool(
    "canon_read",
    {
      description:
        "Read one canon entry by id from canon_find: ref:<topic>#<section>, rule:<id> (a bare rule id such as NS-SLOP-GRADIENT-TEXT works too, with the reasoning and any resolved conflict), arch:<id> or conflict:<id>. A topic id returns its outline with the cost of each section, not the whole reference. Pass full true only when you need the whole reference.",
      inputSchema: { id: z.string().min(3).max(120), full: z.boolean().optional() },
    },
    async ({ id, full }) => {
      try {
        const wanted = /^NS-/i.test(id) ? `rule:${id.toUpperCase()}` : id;
        const found = readEntry(entries(), wanted);
        if (full && found.kind === "ref" && !found.parent) {
          const reference = canon.references.find((r) => `ref:${r.topic}` === found.id);
          if (reference) return text(reference.body);
        }
        const conflicts =
          found.kind === "rule"
            ? canon.arbitration.conflicts
                .filter((c) => c.rules.includes(found.id.slice("rule:".length)))
                .map((c) => `\nConflict resolved: ${c.topic}. ${c.resolution}`)
            : [];
        return text(`${found.id} (~${found.tokens}t)\n${found.body}${conflicts.join("")}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  server.registerTool(
    "northstar_context",
    {
      description:
        "Call this first for any UI design work. Reports the detected stack, whether PRODUCT.md and DESIGN.md exist and are valid, the mode, the likely stage, what is still missing, whether Chrome was started for page tools, and the state of the audit loop.",
    },
    async () => {
      const state = inspectProject(root);
      const status = bridge();
      const bridgeState =
        status.state === "on" ? { daemon: "on" } : { daemon: "off", error: status.error };
      const loop = new LoopStore(root).read();
      return text(
        JSON.stringify(
          {
            ...state,
            bridge: bridgeState,
            browser: browserState(),
            loop: loop ? { url: loop.url, audits: loop.runs.length, max: loop.maxAudits } : null,
          },
          null,
          2,
        ),
      );
    },
  );
}
