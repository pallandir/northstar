import type { Canon } from "@northstar/canon";
import { type DesignRead, readDesign } from "./project.js";
import type { Comment } from "./types.js";

type TokenGroup = "colors" | "typography" | "rounded" | "spacing";

const PROPERTY_GROUPS: Array<[RegExp, TokenGroup | "elevation"]> = [
  [/^(color|background(-color)?|border-color|fill|stroke|outline-color)$/, "colors"],
  [/^(font-[a-z]+|line-height|letter-spacing|text-transform|text-align)$/, "typography"],
  [/^border-(top-|bottom-)?(left-|right-)?radius$/, "rounded"],
  [/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/, "spacing"],
  [/^(width|height|min-width|max-width|min-height|max-height)$/, "spacing"],
  [/^(box-shadow|text-shadow|filter|backdrop-filter)$/, "elevation"],
];

const GROUP_RULES: Record<TokenGroup | "elevation", string[]> = {
  colors: ["NS-A11Y-CONTRAST", "NS-COLOR-RAW-VALUES", "NS-COLOR-PURE-BLACK"],
  typography: [
    "NS-TYPE-DEFAULT-DISPLAY",
    "NS-TYPE-DISPLAY-MAX",
    "NS-TYPE-MEASURE",
    "NS-TYPE-TRACKING-FLOOR",
  ],
  rounded: ["NS-SLOP-NESTED-CARD"],
  spacing: ["NS-LAYOUT-SPACING-RHYTHM", "NS-A11Y-TARGET-SIZE"],
  elevation: ["NS-SLOP-HARD-SHADOW", "NS-SLOP-DECOR-GLASS"],
};

const COPY_RULES = ["NS-COPY-CTA-VERB", "NS-COPY-FILLER", "NS-COPY-ERROR"];
const MAX_TOKENS = 12;
const MAX_VALUE = 60;

export function groupFor(
  property: string | null | undefined,
): TokenGroup | "elevation" | undefined {
  if (!property || !/^[a-z-]{2,40}$/.test(property)) return undefined;
  return PROPERTY_GROUPS.find(([pattern]) => pattern.test(property))?.[1];
}

export function relevantRules(comment: Comment): string[] {
  const rules = new Set<string>();
  const group = groupFor(comment.operation.property);
  if (group) for (const id of GROUP_RULES[group]) rules.add(id);
  if (comment.operation.type === "text" || comment.intent === "copy") {
    for (const id of COPY_RULES) rules.add(id);
  }
  if (comment.intent === "bug") rules.add("NS-A11Y-SEMANTICS");
  if (comment.intent === "change") rules.add("NS-LAYOUT-STATES");
  return [...rules];
}

function tokenLines(design: DesignRead, group: TokenGroup): string[] {
  const section = design.frontmatter?.[group];
  if (!section || typeof section !== "object") return [];
  return Object.entries(section as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .slice(0, MAX_TOKENS)
    .map(([name, value]) => `${name}: ${String(value).slice(0, MAX_VALUE)}`);
}

export function designContext(comment: Comment, root: string, canon: Canon): string {
  const rules = relevantRules(comment);
  const design = readDesign(root);
  const scheme = comment.page?.colorScheme;
  const themed = scheme === "light" || scheme === "dark";
  if (!rules.length && !design.exists && !themed) return "";

  const lines = ["", "Design context (from DESIGN.md and the canon, never from the comment text):"];
  if (design.exists && design.valid) {
    if (design.mode) lines.push(`mode: ${design.mode}`);
    if (design.libraries) {
      const libs = Object.entries(design.libraries).map(([slot, name]) => `${slot} ${name}`);
      lines.push(`libraries: ${libs.join(", ")}`);
    }
    const group = groupFor(comment.operation.property);
    if (group && group !== "elevation") {
      const tokens = tokenLines(design, group);
      if (tokens.length) lines.push(`${group} tokens: ${tokens.join(" | ")}`);
    }
    lines.push(
      "Change the token or the shared component when DESIGN.md defines it, not the single instance.",
    );
  } else if (design.exists) {
    lines.push(
      "DESIGN.md exists but is not valid or complete yet, treat its tokens as unreliable.",
    );
  }
  if (themed) lines.push(`The comment was made in the ${scheme} theme, check the other theme too.`);
  for (const id of rules) {
    const rule = canon.rules.find((r) => r.id === id);
    if (rule) lines.push(`${rule.id}: ${rule.title}. ${rule.fix}`);
  }
  return `${lines.join("\n")}\n`;
}
