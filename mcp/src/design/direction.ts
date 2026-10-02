import { DIMENSIONS, type Dna, characteristicsOf } from "./dna.js";
import type { Intent } from "./intent.js";
import type { Direction, Reference } from "./store.js";

type Dimension = (typeof DIMENSIONS)[number];
type Group = Exclude<keyof Dna, "characteristics">;

const GROUPS: Record<Dimension, Group[]> = {
  typography: ["typography"],
  composition: ["composition", "hierarchy"],
  geometry: ["geometry"],
  color: ["color"],
  navigation: [],
  interaction: [],
};

const DENSITY = { low: 0.25, medium: 0.5, high: 0.75 } as const;
const STRUCTURE = { high: "asymmetric", medium: "mixed", low: "symmetric" } as const;

function intentTarget(intent: Intent): Dna {
  const target: Dna = {};
  const { composition, visual } = intent;
  if (composition.density || composition.whitespace || composition.asymmetry) {
    target.composition = {};
    if (composition.density) target.composition.density = DENSITY[composition.density];
    if (composition.whitespace)
      target.composition.whitespace = 1 - DENSITY[composition.whitespace] + 0.25;
    if (composition.asymmetry) target.composition.structure = STRUCTURE[composition.asymmetry];
  }
  if (visual.saturation || visual.accentColors !== undefined) {
    target.color = {};
    if (visual.saturation) target.color.saturation = visual.saturation;
    if (visual.accentColors !== undefined) target.color.accentCount = visual.accentColors;
  }
  return target;
}

function overlap(reference: Reference, personality: string[]): number {
  const tags = new Set((reference.dna.characteristics ?? []).map((t) => t.toLowerCase()));
  return personality.filter((p) => tags.has(p.toLowerCase())).length;
}

function pick(candidates: Reference[], intent: Intent): Reference {
  return [...candidates].sort(
    (a, b) =>
      overlap(b, intent.personality) - overlap(a, intent.personality) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  )[0] as Reference;
}

export class DirectionError extends Error {}

export function buildDirection(
  intent: Intent,
  references: Reference[],
  now: Date = new Date(),
): Direction {
  const contributing = references.filter((r) => r.contributes.length > 0);
  if (contributing.length === 0) {
    throw new DirectionError(
      "No reference contributes to a dimension yet. Add references with references_add, look at each image, and call references_record with the dimensions it contributes.",
    );
  }
  const dna: Dna = intentTarget(intent);
  const sources: Record<string, string[]> = {};
  const lines: string[] = [];
  for (const dimension of DIMENSIONS) {
    const candidates = contributing.filter((r) => r.contributes.includes(dimension));
    if (candidates.length === 0) continue;
    const chosen = pick(candidates, intent);
    sources[dimension] = candidates.map((r) => r.id);
    for (const group of GROUPS[dimension]) {
      const taken = chosen.dna[group];
      if (taken) Object.assign(dna, { [group]: { ...dna[group], ...taken } });
    }
    lines.push(
      `${dimension} from ${chosen.id} (${chosen.title.slice(0, 60)})${chosen.notes ? `: ${chosen.notes}` : ""}`,
    );
  }
  dna.characteristics = [...new Set([...intent.personality, ...characteristicsOf(dna)])].slice(
    0,
    12,
  );
  const tokenHints: Record<string, string> = {};
  const add = (key: string, value: string | number | undefined) => {
    if (value !== undefined) tokenHints[key] = String(value);
  };
  add("radius", dna.geometry?.radius);
  add("fontStyle", dna.typography?.style);
  add("background", dna.color?.background);
  add("saturation", dna.color?.saturation);
  add("accentCount", dna.color?.accentCount);
  const summary = [
    `Direction: ${dna.characteristics.join(", ")}.`,
    ...lines,
    intent.avoid.length ? `Avoid: ${intent.avoid.join(", ")}.` : "",
    "Build from these principles. Never copy a reference.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    createdAt: now.toISOString(),
    intent,
    dna,
    sources,
    avoid: intent.avoid,
    tokenHints,
    summary,
  };
}
