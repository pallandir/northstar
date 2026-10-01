import { DOMAINS, type DesignData, type Row, getRow, search } from "@northstar/data";
import { z } from "zod";
import type { PackRegistry } from "./registry.js";
import { error, modeSchema, text } from "./util.js";

const domainSchema = z.enum(DOMAINS);

const SUMMARY_FIELDS = 4;

export function brief(row: Row): string {
  const facts = Object.entries(row.fields)
    .slice(0, SUMMARY_FIELDS)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
  const caution = row.caution ? `\n  caution: ${row.caution}` : "";
  return `- ${row.id}: ${row.name}\n  ${row.summary}\n  ${facts}${caution}`;
}

export function full(row: Row): string {
  const lines = [`# ${row.name} (${row.id})`, "", row.summary, ""];
  for (const [key, value] of Object.entries(row.fields)) lines.push(`${key}: ${value}`);
  if (row.modes.length) lines.push(`modes: ${row.modes.join(", ")}`);
  if (row.caution) lines.push("", `Caution: ${row.caution}`);
  return lines.join("\n");
}

export function registerResearch(registry: PackRegistry, data: () => DesignData): void {
  registry.register(
    "research",
    "design_search",
    {
      description:
        "Search the curated design data. Domains: styles, palettes (by product type), typography (font pairings), products (what to build for a product type), reasoning (decision rules per category), ux (guidelines), charts, landing (page patterns), icons, fonts. Results are candidates, filtered by the canon: respect any caution on a row. Returns compact rows, call design_get for one in full.",
      inputSchema: {
        domain: domainSchema,
        query: z.string().min(2).max(300),
        mode: modeSchema.optional(),
        limit: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ domain, query, mode, limit }) => {
      const rows = search(data(), { domain, query, mode, limit: limit ?? 5 });
      if (!rows.length)
        return text(`No ${domain} rows match "${query}". Try fewer or broader words.`);
      return text(rows.map(brief).join("\n"));
    },
  );

  registry.register(
    "research",
    "design_get",
    {
      description: "Read one design data row in full by its id, for example styles:glassmorphism.",
      inputSchema: { id: z.string().min(3).max(120) },
    },
    async ({ id }) => {
      const domain = domainSchema.safeParse(id.split(":")[0]);
      const row = domain.success ? getRow(data(), domain.data, id) : undefined;
      if (!row) return error(`No design row with id ${id}.`);
      return text(full(row));
    },
  );
}
