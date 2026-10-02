import type { Intent } from "../design/intent.js";

const DIMENSION_QUERIES = ["composition", "typography", "product", "visual"] as const;

export interface SearchQuery {
  dimension: (typeof DIMENSION_QUERIES)[number];
  query: string;
}

const tidy = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

export function intentTerms(intent: Intent): string[] {
  return [intent.product.category, intent.product.surface, ...intent.personality];
}

export function queriesFor(intent: Intent): SearchQuery[] {
  const { category, surface } = intent.product;
  const traits = intent.personality.slice(0, 2).join(" ");
  const muted = intent.visual.saturation === "low" ? "muted" : "";
  return [
    { dimension: "composition", query: tidy(`${traits} ${category} ${surface} layout`) },
    {
      dimension: "typography",
      query: tidy(`${intent.typography.character ?? traits} ${category} website typography`),
    },
    { dimension: "product", query: tidy(`${category} ${surface} web design`) },
    {
      dimension: "visual",
      query: tidy(`${muted} ${intent.personality[0] ?? ""} ${surface} design`),
    },
  ];
}
