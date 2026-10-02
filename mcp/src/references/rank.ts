import type { Candidate } from "../design/store.js";

const KEEP = 12;
const MIN_ALT = 8;

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

function imageKey(image: string): string {
  try {
    const url = new URL(image);
    return `${url.host}${url.pathname.replace(/\/\d+x\d*\//, "/")}`;
  } catch {
    return image;
  }
}

export function rankCandidates(
  candidates: readonly Candidate[],
  terms: readonly string[],
  keep = KEEP,
): Candidate[] {
  const wanted = new Set(terms.flatMap(tokens));
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const keys = [imageKey(c.image), c.link].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  });
  const scored = unique
    .map((c) => ({
      c,
      score:
        tokens(c.title).filter((t) => wanted.has(t)).length + (c.title.length >= MIN_ALT ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const buckets = new Map<string, Candidate[]>();
  for (const { c } of scored) {
    const key = `${c.provider}|${c.query}`;
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }
  const picked: Candidate[] = [];
  const queues = [...buckets.values()];
  while (picked.length < keep && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && picked.length < keep) picked.push(next);
    }
  }
  return picked;
}
