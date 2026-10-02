import type { Domain } from "./schema.js";

export interface PredicateInput {
  domain: Domain;
  name: string;
  fields: Record<string, string>;
}

export interface Predicate {
  id: string;
  rule: string;
  test: (input: PredicateInput, defaultFamilies: string[]) => boolean;
}

const CAUTIONARY_FIELDS = new Set(["antiPatterns", "avoidFor", "dont", "bad", "whenNot"]);

function haystack(input: PredicateInput): string {
  const advice = Object.entries(input.fields)
    .filter(([key]) => !CAUTIONARY_FIELDS.has(key))
    .map(([, value]) => value);
  return `${input.name} ${advice.join(" ")}`;
}

const EMOJI = /\p{Extended_Pictographic}/u;

const PREDICATES: Predicate[] = [
  {
    id: "gradient-text",
    rule: "NS-SLOP-GRADIENT-TEXT",
    test: (input) =>
      /gradient[- ]text|text[- ]gradient|background-clip:\s*text|masked ?view gradient/i.test(
        haystack(input),
      ),
  },
  {
    id: "glass",
    rule: "NS-SLOP-DECOR-GLASS",
    test: (input) => input.domain === "styles" && /glass|liquid|frosted|aurora/i.test(input.name),
  },
  {
    id: "ai-gradient",
    rule: "NS-LOOK-DEFAULT-PALETTE",
    test: (input) =>
      /purple.{0,12}(pink|blue|cyan)|indigo.{0,12}cyan|ai purple|neon gradient/i.test(
        haystack(input),
      ),
  },
  {
    id: "default-display-font",
    rule: "NS-TYPE-DEFAULT-DISPLAY",
    test: (input, families) =>
      input.domain === "typography" &&
      families.some(
        (family) => family.toLowerCase() === (input.fields.heading ?? "").toLowerCase(),
      ),
  },
  {
    id: "caps-labels",
    rule: "NS-SLOP-CAPS-LABELS",
    test: (input) =>
      input.domain === "typography" &&
      /uppercase|all caps|small caps|tracked/i.test(haystack(input)),
  },
  {
    id: "emoji-icon",
    rule: "NS-SLOP-EMOJI-ICON",
    test: (input) => input.domain === "icons" && EMOJI.test(haystack(input)),
  },
  {
    id: "hard-shadow",
    rule: "NS-SLOP-HARD-SHADOW",
    test: (input) =>
      input.domain === "styles" &&
      /brutal|hard shadow|offset shadow|\b[4-9]px [4-9]px 0\b/i.test(haystack(input)),
  },
  {
    id: "eyebrow",
    rule: "NS-SLOP-EYEBROW",
    test: (input) => /eyebrow|kicker/i.test(haystack(input)),
  },
];

export function matchedPredicates(input: PredicateInput, defaultFamilies: string[]): Predicate[] {
  return PREDICATES.filter((predicate) => predicate.test(input, defaultFamilies));
}
