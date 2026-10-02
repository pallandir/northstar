import type { Canon } from "./load.js";
import { renderRule } from "./render.js";

export type EntryKind = "ref" | "rule" | "archetype" | "conflict";

export interface CatalogEntry {
  id: string;
  kind: EntryKind;
  title: string;
  summary: string;
  keywords: string;
  body: string;
  stages: string[];
  tokens: number;
  parent?: string;
}

export interface Hit {
  id: string;
  kind: EntryKind;
  title: string;
  summary: string;
  tokens: number;
}

export interface FindOptions {
  kind?: EntryKind;
  stage?: string;
  limit?: number;
  budget?: number;
}

export interface FindResult {
  hits: Hit[];
  spent: number;
  corrected: Array<[string, string]>;
  expanded: string[];
  skipped: number;
}

export const DEFAULT_LIMIT = 6;
export const MAX_LIMIT = 12;
export const DEFAULT_BUDGET = 700;
const PER_PARENT = 3;
const CHUNK_TOKENS = 320;

const STAGES_OF_TOPIC: Record<string, string[]> = {
  brief: ["brief"],
  direction: ["direction"],
  archetypes: ["direction", "system"],
  system: ["system"],
  color: ["system", "compose"],
  typography: ["system", "compose"],
  libraries: ["system", "compose"],
  figma: ["system"],
  compose: ["compose"],
  layout: ["compose"],
  copy: ["compose", "polish"],
  critique: ["critique"],
  polish: ["polish"],
  finish: ["polish", "compose"],
  interaction: ["polish", "compose"],
  motion: ["polish", "compose"],
  a11y: ["compose", "polish"],
  refine: ["critique", "polish"],
  adapt: ["system", "compose"],
  modernise: ["brief", "direction", "system"],
  comments: ["polish"],
};

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

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function oneLine(value: string, max = 130): string {
  const clean = value.replace(/\s+/g, " ").trim();
  const cut = clean.search(/[.!?](\s|$)/);
  const sentence = cut > 20 ? clean.slice(0, cut + 1) : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}` : sentence;
}

function firstProse(lines: string[]): string {
  for (const line of lines) {
    const t = line.trim();
    if (
      !t ||
      t.startsWith("#") ||
      t.startsWith("|") ||
      t.startsWith("```") ||
      /^[-*]\s*$/.test(t)
    ) {
      continue;
    }
    return oneLine(
      t
        .replace(/^[-*]\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, ""),
    );
  }
  return "";
}

function entry(partial: Omit<CatalogEntry, "tokens"> & { tokens?: number }): CatalogEntry {
  return { ...partial, tokens: partial.tokens ?? estimateTokens(partial.body) };
}

function chunksOf(lines: string[]): string[][] {
  if (estimateTokens(lines.join("\n")) <= CHUNK_TOKENS * 1.3) return [lines];
  const chunks: string[][] = [];
  let current: string[] = [];
  let spent = 0;
  for (const line of lines) {
    const cost = estimateTokens(line) + 1;
    const boundary = /^[-*] |^\|?\s*[A-Za-z]/.test(line) || line.trim() === "";
    if (spent >= CHUNK_TOKENS && boundary && line.trim() !== "" && current.length) {
      chunks.push(current);
      current = [];
      spent = 0;
    }
    current.push(line);
    spent += cost;
  }
  if (current.length) chunks.push(current);
  return chunks.map((chunk, i) => (i === 0 ? chunk : chunk));
}

function referenceEntries(canon: Canon): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const reference of canon.references) {
    const lines = reference.body.split("\n");
    const sections: Array<{ title: string; lines: string[] }> = [];
    let current: { title: string; lines: string[] } = { title: "Overview", lines: [] };
    for (const line of lines.slice(1)) {
      if (line.startsWith("## ")) {
        sections.push(current);
        current = { title: line.slice(3).trim(), lines: [line] };
      } else current.lines.push(line);
    }
    sections.push(current);
    const real = sections.filter((s) =>
      s.lines.some((l) => l.trim() && !l.startsWith("Load when:")),
    );
    const stages = STAGES_OF_TOPIC[reference.topic] ?? [];
    const outline = real
      .map((s) => {
        const body = s.lines.join("\n");
        return `- ref:${reference.topic}#${slug(s.title)} (~${estimateTokens(body)}t) ${s.title}`;
      })
      .join("\n");
    out.push(
      entry({
        id: `ref:${reference.topic}`,
        kind: "ref",
        title: reference.title,
        summary: reference.loadWhen,
        keywords: `${reference.topic} ${real.map((s) => s.title).join(" ")}`,
        body: `${reference.title}. ${reference.loadWhen}\nSections, read one at a time:\n${outline}`,
        stages,
        tokens: estimateTokens(reference.body),
      }),
    );
    for (const section of real) {
      const body = section.lines.join("\n").trim();
      for (const [at, chunk] of chunksOf(section.lines).entries()) {
        const suffix = at === 0 ? "" : `-${at + 1}`;
        out.push(
          entry({
            id: `ref:${reference.topic}#${slug(section.title)}${suffix}`,
            kind: "ref",
            title: `${reference.title}: ${section.title}${at === 0 ? "" : ` (${at + 1})`}`,
            summary: firstProse(chunk),
            keywords: `${reference.topic} ${section.title}`,
            body: chunk.join("\n").trim() || body,
            stages,
            parent: `ref:${reference.topic}`,
          }),
        );
      }
    }
  }
  return out;
}

function ruleEntries(canon: Canon): CatalogEntry[] {
  return canon.rules.map((rule) =>
    entry({
      id: `rule:${rule.id}`,
      kind: "rule",
      title: `${rule.id} ${rule.title}`,
      summary: oneLine(rule.rationale),
      keywords: `${rule.id.replace(/-/g, " ")} ${rule.stage.join(" ")} ${rule.fix}`,
      body: renderRule(rule),
      stages: [...rule.stage],
    }),
  );
}

function archetypeEntries(canon: Canon): CatalogEntry[] {
  return canon.archetypes.archetypes.map((a) =>
    entry({
      id: `arch:${a.id}`,
      kind: "archetype",
      title: `Archetype ${a.title}`,
      summary: oneLine(a.summary),
      keywords: `${a.modes.join(" ")} ${a.fonts.heading} ${a.fonts.body} ${a.seeds.shape} ${a.seeds.density} ${a.layout.join(" ")}`,
      body: [
        `# ${a.title}`,
        a.summary,
        `Suits: ${a.modes.join(", ")}. Shape ${a.seeds.shape}, density ${a.seeds.density}, feel ${a.seeds.feel}, hue ${a.seeds.hue}, temperature ${a.seeds.temperature}.`,
        `Fonts: ${a.fonts.heading} for headings, ${a.fonts.body} for body, ${a.fonts.mono} for code.`,
        `Depth: ${a.depth}`,
        `Layout moves: ${a.layout.join("; ")}.`,
        `Avoid: ${a.avoid.join("; ")}.`,
        `Dials: variance ${a.dials.variance}, motion ${a.dials.motion}, density ${a.dials.density}.`,
      ].join("\n"),
      stages: ["direction", "system"],
    }),
  );
}

function conflictEntries(canon: Canon): CatalogEntry[] {
  return canon.arbitration.conflicts.map((c) =>
    entry({
      id: `conflict:${c.id}`,
      kind: "conflict",
      title: c.topic,
      summary: oneLine(c.resolution),
      keywords: `${c.topic} ${c.rules.join(" ").replace(/-/g, " ")}`,
      body: `${c.topic}\n${c.resolution}\nRules: ${c.rules.join(", ")}`,
      stages: [],
    }),
  );
}

export function buildCatalog(canon: Canon): CatalogEntry[] {
  return [
    ...referenceEntries(canon),
    ...ruleEntries(canon),
    ...archetypeEntries(canon),
    ...conflictEntries(canon),
  ];
}

interface Doc {
  entry: CatalogEntry;
  terms: Map<string, number>;
  length: number;
}

interface Index {
  docs: Doc[];
  df: Map<string, number>;
  average: number;
  vocabulary: string[];
  synonyms: Map<string, string[]>;
  byId: Map<string, CatalogEntry>;
}

const FIELD = { title: 4, keywords: 3, summary: 2, body: 1 };
const K1 = 1.2;
const B = 0.75;
const EXPANSION_WEIGHT = 0.4;
const SECTION_BOOST = 1.15;
const STAGE_BOOST = 1.25;

const indexes = new WeakMap<CatalogEntry[], Index>();

function indexOf(entries: CatalogEntry[], canon: Canon): Index {
  const cached = indexes.get(entries);
  if (cached) return cached;
  const df = new Map<string, number>();
  const docs = entries.map((e): Doc => {
    const terms = new Map<string, number>();
    let length = 0;
    const add = (text: string, weight: number) => {
      for (const token of tokenize(text)) {
        terms.set(token, (terms.get(token) ?? 0) + weight);
        length += weight;
      }
    };
    add(e.title, FIELD.title);
    add(e.keywords, FIELD.keywords);
    add(e.summary, FIELD.summary);
    add(e.body, FIELD.body);
    for (const term of terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return { entry: e, terms, length };
  });
  const synonyms = new Map<string, string[]>();
  for (const [key, list] of Object.entries(canon.synonyms)) {
    const [head] = tokenize(key);
    if (head) synonyms.set(head, [...new Set(list.flatMap((item) => tokenize(item)))]);
  }
  const index: Index = {
    docs,
    df,
    average: docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length),
    vocabulary: [...df.keys()],
    synonyms,
    byId: new Map(entries.map((e) => [e.id, e])),
  };
  indexes.set(entries, index);
  return index;
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    previous = row;
  }
  return previous[b.length] ?? max + 1;
}

function correct(term: string, index: Index): string | undefined {
  if (index.df.has(term) || term.length < 5) return undefined;
  let best: string | undefined;
  let bestDf = 0;
  const max = term.length >= 8 ? 2 : 1;
  for (const word of index.vocabulary) {
    if (editDistance(term, word, max) <= max) {
      const df = index.df.get(word) ?? 0;
      if (df > bestDf) {
        best = word;
        bestDf = df;
      }
    }
  }
  return best;
}

export function findInCatalog(
  entries: CatalogEntry[],
  canon: Canon,
  query: string,
  options: FindOptions = {},
): FindResult {
  const index = indexOf(entries, canon);
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
  const budget = options.budget ?? DEFAULT_BUDGET;

  const direct: CatalogEntry[] = [];
  for (const match of query.matchAll(/\b(NS-[A-Z0-9]+(?:-[A-Z0-9]+)+)\b/gi)) {
    const found = index.byId.get(`rule:${(match[1] ?? "").toUpperCase()}`);
    if (found) direct.push(found);
  }
  for (const match of query.matchAll(/\b((?:ref|arch|conflict):[a-z0-9#-]+)\b/g)) {
    const found = index.byId.get(match[1] ?? "");
    if (found) direct.push(found);
  }

  const corrected: Array<[string, string]> = [];
  const weights = new Map<string, number>();
  const expanded: string[] = [];
  for (const raw of new Set(tokenize(query))) {
    const fixed = correct(raw, index);
    const term = fixed ?? raw;
    if (fixed) corrected.push([raw, fixed]);
    weights.set(term, Math.max(weights.get(term) ?? 0, 1));
    for (const extra of index.synonyms.get(term) ?? []) {
      if (!weights.has(extra)) {
        weights.set(extra, EXPANSION_WEIGHT);
        expanded.push(extra);
      }
    }
  }

  const count = index.docs.length;
  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const doc of index.docs) {
    if (options.kind && doc.entry.kind !== options.kind) continue;
    let score = 0;
    for (const [term, weight] of weights) {
      const tf = doc.terms.get(term);
      if (!tf) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5));
      score +=
        weight * ((idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + (B * doc.length) / index.average)));
    }
    if (score <= 0) continue;
    if (doc.entry.parent) score *= SECTION_BOOST;
    if (options.stage && doc.entry.stages.includes(options.stage)) score *= STAGE_BOOST;
    scored.push({ entry: doc.entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

  const ordered = [...direct, ...scored.map((s) => s.entry)];
  const seen = new Set<string>();
  const perParent = new Map<string, number>();
  const hits: Hit[] = [];
  let spent = 0;
  let skipped = 0;
  for (const e of ordered) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (options.kind && e.kind !== options.kind) continue;
    const family = e.parent ?? e.id;
    if ((perParent.get(family) ?? 0) >= PER_PARENT) continue;
    const cost = estimateTokens(`${e.id} ${e.title} ${e.summary}`) + 4;
    if (hits.length >= limit || spent + cost > budget) {
      skipped++;
      continue;
    }
    perParent.set(family, (perParent.get(family) ?? 0) + 1);
    spent += cost;
    hits.push({ id: e.id, kind: e.kind, title: e.title, summary: e.summary, tokens: e.tokens });
  }
  return { hits, spent, corrected, expanded, skipped };
}

export function readEntry(entries: CatalogEntry[], id: string): CatalogEntry {
  const found = entries.find((e) => e.id === id);
  if (found) return found;
  const prefix = id.split("#")[0] ?? id;
  const near = entries
    .filter((e) => e.id.startsWith(prefix) || e.id.includes(id.replace(/^[a-z]+:/, "")))
    .slice(0, 6)
    .map((e) => e.id);
  throw new Error(
    `no entry ${id}. ${near.length ? `Did you mean ${near.join(", ")}?` : "Call canon_find to search by what you need."}`,
  );
}

export function renderHits(result: FindResult): string {
  const lines = result.hits.map((h) => `${h.id} (~${h.tokens}t) ${h.summary || h.title}`);
  const notes: string[] = [];
  if (result.corrected.length) {
    notes.push(`corrected: ${result.corrected.map(([a, b]) => `${a} to ${b}`).join(", ")}`);
  }
  if (result.skipped) notes.push(`${result.skipped} more matched, narrow the query or raise limit`);
  return [...lines, ...notes].join("\n");
}

export function renderIndex(canon: Canon, entries: CatalogEntry[]): string {
  const families = new Map<string, number>();
  for (const rule of canon.rules) {
    const family = rule.id.split("-").slice(0, 2).join("-");
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  const lines = [
    "# Northstar index",
    "",
    "Search first, read one section. With the server: canon_find with what you need, then canon_read with an id. Without it: find the topic below, open references/<topic>.md and read only the section you need. Never load a whole reference.",
    "",
    "## References",
    "",
  ];
  for (const reference of canon.references) {
    const sections = entries
      .filter((e) => e.parent === `ref:${reference.topic}`)
      .map((e) => e.id.split("#")[1])
      .join(", ");
    lines.push(`- ${reference.topic}: ${reference.loadWhen} Sections: ${sections}.`);
  }
  lines.push(
    "",
    "## Rules",
    "",
    `${canon.rules.length} rules in families ${[...families].map(([k, n]) => `${k} (${n})`).join(", ")}. Look one up by id: canon_read rule:<id>.`,
    "",
    "## Archetypes",
    "",
    canon.archetypes.archetypes.map((a) => `${a.id} (${a.modes.join(", ")})`).join("; "),
    "",
    "## Conflicts already resolved",
    "",
    canon.arbitration.conflicts.map((c) => c.id).join(", "),
    "",
    "## Ids",
    "",
    "ref:<topic>, ref:<topic>#<section>, rule:<id>, arch:<id>, conflict:<id>",
  );
  return `${lines.join("\n")}\n`;
}
