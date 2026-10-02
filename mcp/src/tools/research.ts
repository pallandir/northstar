import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DOMAINS, type DesignData, type Row, getRow, search } from "../data/index.js";
import { error, modeSchema, text } from "./util.js";

const domainSchema = z.enum(DOMAINS);

const SUMMARY_FIELDS = 4;

function brief(row: Row): string {
  const facts = Object.entries(row.fields)
    .slice(0, SUMMARY_FIELDS)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
  const caution = row.caution ? `\n  caution: ${row.caution}` : "";
  return `- ${row.id}: ${row.name}\n  ${row.summary}\n  ${facts}${caution}`;
}

function full(row: Row): string {
  const lines = [`# ${row.name} (${row.id})`, "", row.summary, ""];
  for (const [key, value] of Object.entries(row.fields)) lines.push(`${key}: ${value}`);
  if (row.modes.length) lines.push(`modes: ${row.modes.join(", ")}`);
  if (row.caution) lines.push("", `Caution: ${row.caution}`);
  return lines.join("\n");
}

export function registerResearch(server: McpServer, data: () => DesignData): void {
  server.registerTool(
    "design_search",
    {
      description:
        "Search the curated design data, or read one row in full. Pass domain and query to search, or id (for example styles:glassmorphism) to read one row. Domains: styles, palettes (by product type), typography (font pairings), products (what to build for a product type), reasoning (decision rules per category), ux (guidelines), charts, landing (page patterns), icons, fonts. Results are candidates, filtered by the canon: respect any caution on a row.",
      inputSchema: {
        domain: domainSchema.optional(),
        query: z.string().min(2).max(300).optional(),
        id: z.string().min(3).max(120).optional(),
        mode: modeSchema.optional(),
        limit: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ domain, query, id, mode, limit }) => {
      if (id !== undefined) {
        if (domain !== undefined || query !== undefined) {
          return error("Pass either id, or domain with query, not both.");
        }
        const idDomain = domainSchema.safeParse(id.split(":")[0]);
        const row = idDomain.success ? getRow(data(), idDomain.data, id) : undefined;
        if (!row) return error(`No design row with id ${id}.`);
        return text(full(row));
      }
      if (domain === undefined || query === undefined) {
        return error("Pass domain and query to search, or id to read one row.");
      }
      const rows = search(data(), { domain, query, mode, limit: limit ?? 5 });
      if (!rows.length)
        return text(`No ${domain} rows match "${query}". Try fewer or broader words.`);
      return text(rows.map(brief).join("\n"));
    },
  );
}
