import MiniSearch from "minisearch";
import type { Row } from "./schema.js";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "are",
  "can",
]);

function processTerm(term: string): string | null {
  const lower = term.toLowerCase();
  if (lower.length < 2 || STOPWORDS.has(lower)) return null;
  return lower.length > 3 && lower.endsWith("s") ? lower.slice(0, -1) : lower;
}

export class Bm25Index {
  private readonly rows = new Map<string, Row>();
  private readonly index = new MiniSearch<Row>({
    fields: ["name", "keywords", "summary", "details"],
    idField: "id",
    extractField: (row, field) =>
      field === "details" ? Object.values(row.fields).join(" ") : (row as never)[field],
    tokenize: (text) => text.split(/[^a-z0-9]+/i),
    processTerm,
    searchOptions: { boost: { name: 3, keywords: 2 }, processTerm },
  });

  constructor(rows: Row[]) {
    for (const row of rows) this.rows.set(row.id, row);
    this.index.addAll(rows);
  }

  search(query: string, limit: number, accept: (row: Row) => boolean = () => true): Row[] {
    return this.index
      .search(query, { filter: (hit) => accept(this.rows.get(hit.id) as Row) })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((hit) => this.rows.get(hit.id) as Row);
  }
}
