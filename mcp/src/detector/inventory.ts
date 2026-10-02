import { isGenericFamily } from "../design-md/index.js";
import { extractDecls, extractEmbeddedDecls, kindOf, lineIndex } from "./extract.js";
import { commaParts } from "./rules/util.js";

export interface InventoryFile {
  file: string;
  text: string;
}

interface Tally {
  distinct: number;
  uses: number;
  top: Array<{ value: string; count: number; at: string }>;
}

export interface Inventory {
  files: number;
  categories: Record<string, Tally>;
  tokenised: { colors: number; total: number };
  drift: string[];
  verdicts: string[];
}

const COLOR =
  /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:oklch|rgba?|hsla?)\([^)]*\)/g;
const LENGTH = /(?<![\w.#-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\b/g;
const LIMITS: Record<string, [number, string]> = {
  colors: [14, "a system needs 6 to 12 colour roles"],
  radii: [5, "use one radius scale of 4 or 5 steps"],
  shadows: [5, "use one elevation scale of 4 or 5 levels"],
  fontSizes: [9, "use one type scale of 6 to 8 steps"],
  fontFamilies: [2, "use one or two families"],
  spacing: [12, "use one spacing scale on a 4px base"],
  zIndexes: [6, "use a small named z index scale"],
  durations: [5, "use 3 or 4 duration tokens"],
};

function normaliseColor(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : v;
}

class Counter {
  private readonly map = new Map<string, { count: number; at: string }>();
  add(value: string, at: string): void {
    const found = this.map.get(value);
    if (found) found.count++;
    else this.map.set(value, { count: 1, at });
  }
  has(value: string): boolean {
    return this.map.has(value);
  }
  tally(topN: number): Tally {
    const entries = [...this.map.entries()].sort((a, b) => b[1].count - a[1].count);
    return {
      distinct: entries.length,
      uses: entries.reduce((sum, [, v]) => sum + v.count, 0),
      top: entries.slice(0, topN).map(([value, v]) => ({ value, count: v.count, at: v.at })),
    };
  }
}

function designSets(design: Record<string, unknown> | undefined) {
  const sets = {
    colors: new Set<string>(),
    radii: new Set<string>(),
    families: new Set<string>(),
  };
  if (!design) return undefined;
  const walk = (node: unknown, visit: (value: string) => void) => {
    if (typeof node === "string") visit(node);
    else if (node && typeof node === "object") {
      for (const item of Object.values(node)) walk(item, visit);
    }
  };
  walk(design.colors, (v) => sets.colors.add(normaliseColor(v)));
  walk((design.themes as Record<string, unknown> | undefined)?.dark, (v) => {
    if (/^#|^oklch|^rgb|^hsl/i.test(v)) sets.colors.add(normaliseColor(v));
  });
  walk(design.rounded, (v) => sets.radii.add(v.trim()));
  const typography = (design.typography ?? {}) as Record<string, { fontFamily?: unknown }>;
  for (const role of Object.values(typography)) {
    if (typeof role?.fontFamily === "string") {
      sets.families.add(
        role.fontFamily.split(",")[0]?.trim().replace(/["']/g, "").toLowerCase() ?? "",
      );
    }
  }
  return sets;
}

export function inventory(
  files: InventoryFile[],
  design?: Record<string, unknown>,
  topN = 5,
): Inventory {
  const counters: Record<string, Counter> = Object.fromEntries(
    Object.keys(LIMITS).map((key) => [key, new Counter()]),
  );
  let tokenisedColors = 0;
  let rawColors = 0;
  let scanned = 0;
  const sets = designSets(design);
  const drift = new Map<string, string>();

  for (const { file, text } of files) {
    const kind = kindOf(file);
    if (!kind) continue;
    scanned++;
    const lineOf = lineIndex(text);
    const decls = kind === "css" ? extractDecls(text) : extractEmbeddedDecls(text);
    for (const d of decls) {
      const at = `${file}:${lineOf(d.index)}`;
      const isToken = d.prop.startsWith("--");
      if (!isToken) {
        for (const match of d.value.match(COLOR) ?? []) {
          const color = normaliseColor(match);
          counters.colors?.add(color, at);
          rawColors++;
          if (sets && !sets.colors.has(color) && !drift.has(`color ${color}`)) {
            drift.set(`color ${color}`, at);
          }
        }
        if (/var\(--[\w-]*(color|bg|text|border|surface|primary|accent)/i.test(d.value)) {
          tokenisedColors++;
        }
      } else {
        for (const match of d.value.match(COLOR) ?? []) {
          counters.colors?.add(normaliseColor(match), at);
        }
      }
      if (d.prop === "border-radius" || /^border-(top|bottom)-(left|right)-radius$/.test(d.prop)) {
        for (const part of d.value
          .split(/[\s/]+/)
          .filter((p) => LENGTH.test(p) || /^\d+%$/.test(p))) {
          LENGTH.lastIndex = 0;
          counters.radii?.add(part, at);
          if (sets?.radii.size && !sets.radii.has(part) && !d.value.includes("var(")) {
            drift.set(`radius ${part}`, at);
          }
        }
        LENGTH.lastIndex = 0;
      }
      if (d.prop === "box-shadow" && !/^(none|inherit|initial|unset)$/i.test(d.value.trim())) {
        if (!d.value.includes("var(")) counters.shadows?.add(commaParts(d.value).join(", "), at);
      }
      if (d.prop === "font-size" && !d.value.includes("var("))
        counters.fontSizes?.add(d.value.trim(), at);
      if (d.prop === "font-family" && !d.value.includes("var(")) {
        const first = commaParts(d.value)[0]?.replace(/["']/g, "").trim() ?? "";
        if (first && !isGenericFamily(first)) {
          counters.fontFamilies?.add(first, at);
          if (sets?.families.size && !sets.families.has(first.toLowerCase())) {
            drift.set(`font ${first}`, at);
          }
        }
      }
      if (
        /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/.test(d.prop) &&
        !d.value.includes("var(")
      ) {
        for (const match of d.value.match(LENGTH) ?? []) counters.spacing?.add(match, at);
        LENGTH.lastIndex = 0;
      }
      if (d.prop === "z-index" && /^-?\d+$/.test(d.value.trim()))
        counters.zIndexes?.add(d.value.trim(), at);
      if (/^(transition|transition-duration|animation|animation-duration)$/.test(d.prop)) {
        for (const part of commaParts(d.value)) {
          const time = /(?:^|\s)(\d*\.?\d+(?:ms|s))(?=\s|$)/.exec(part);
          if (time?.[1]) counters.durations?.add(time[1], at);
        }
      }
    }
  }

  const categories = Object.fromEntries(
    Object.entries(counters).map(([key, counter]) => [key, counter.tally(topN)]),
  );
  const verdicts = Object.entries(LIMITS)
    .filter(([key, [limit]]) => (categories[key]?.distinct ?? 0) > limit)
    .map(([key, [, advice]]) => `${key}: ${categories[key]?.distinct} distinct, ${advice}`);
  return {
    files: scanned,
    categories,
    tokenised: { colors: tokenisedColors, total: tokenisedColors + rawColors },
    drift: [...drift.entries()]
      .slice(0, 12)
      .map(([what, at]) => `${what} at ${at} is not in DESIGN.md`),
    verdicts,
  };
}

export function formatInventory(inv: Inventory): string {
  const lines = [`Inventory of ${inv.files} files.`];
  for (const [key, tally] of Object.entries(inv.categories)) {
    if (!tally.distinct) continue;
    const top = tally.top.map((t) => `${t.value} x${t.count}`).join(", ");
    lines.push(`${key}: ${tally.distinct} distinct, ${tally.uses} uses. Most used: ${top}.`);
  }
  if (inv.tokenised.total) {
    const pct = Math.round((inv.tokenised.colors / inv.tokenised.total) * 100);
    lines.push(
      `colour usage: ${pct}% goes through tokens, ${inv.tokenised.total - inv.tokenised.colors} raw values.`,
    );
  }
  if (inv.verdicts.length) lines.push("", "Too many:", ...inv.verdicts.map((v) => `- ${v}`));
  if (inv.drift.length) lines.push("", "Drift from DESIGN.md:", ...inv.drift.map((v) => `- ${v}`));
  return lines.join("\n");
}
