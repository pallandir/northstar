import { z } from "zod";
import type { IngestStatus } from "../ingest-status.js";
import { inspectProject } from "../project.js";
import { PACK_NAMES, PACK_SUMMARIES, type PackName, type PackRegistry } from "./registry.js";
import { text } from "./util.js";

const packSchema = z.enum(PACK_NAMES);

export function registerCore(
  registry: PackRegistry,
  root: string,
  ingest: () => IngestStatus,
): void {
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
