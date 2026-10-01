import type { Row } from "./schema.js";

const K1 = 1.2;
const B = 0.75;
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
const BOOST = { name: 3, keywords: 2, summary: 1, fields: 1 };

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token));
}

interface Doc {
  row: Row;
  terms: Map<string, number>;
  length: number;
}

export class Bm25Index {
  private readonly docs: Doc[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(rows: Row[]) {
    this.docs = rows.map((row) => this.toDoc(row));
    for (const doc of this.docs) {
      for (const term of doc.terms.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
    const total = this.docs.reduce((sum, doc) => sum + doc.length, 0);
    this.averageLength = this.docs.length ? total / this.docs.length : 1;
  }

  private toDoc(row: Row): Doc {
    const terms = new Map<string, number>();
    let length = 0;
    const add = (text: string, weight: number) => {
      for (const token of tokenize(text)) {
        terms.set(token, (terms.get(token) ?? 0) + weight);
        length += weight;
      }
    };
    add(row.name, BOOST.name);
    add(row.keywords, BOOST.keywords);
    add(row.summary, BOOST.summary);
    add(Object.values(row.fields).join(" "), BOOST.fields);
    return { row, terms, length };
  }

  search(query: string, limit: number, accept: (row: Row) => boolean = () => true): Row[] {
    const queryTerms = [...new Set(tokenize(query))];
    const count = this.docs.length;
    const scored: Array<{ row: Row; score: number }> = [];
    for (const doc of this.docs) {
      if (!accept(doc.row)) continue;
      let score = 0;
      for (const term of queryTerms) {
        const tf = doc.terms.get(term);
        if (!tf) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5));
        score +=
          (idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + (B * doc.length) / this.averageLength));
      }
      if (score > 0) scored.push({ row: doc.row, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
      .slice(0, limit)
      .map((entry) => entry.row);
  }
}
