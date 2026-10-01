import { stringify } from "yaml";

export interface NormalizeOptions {
  knownFamilies?: Set<string>;
  stack?: string;
}

export interface NormalizeReport {
  extracted: {
    name?: string;
    colors: string[];
    fonts: string[];
    mode?: string;
    libraries: string[];
    rounded: boolean;
    spacing: boolean;
  };
  missing: string[];
  questions: string[];
}

export interface NormalizeResult {
  markdown: string;
  report: NormalizeReport;
}

const COLOR =
  /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|oklch\([^)]*\)|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

const ROLE_WORDS: Array<[string, RegExp]> = [
  ["primary", /\bprimary|brand\b/],
  ["secondary", /\bsecondary\b/],
  ["accent", /\baccent|tertiary|highlight\b/],
  ["background", /\bbackground|canvas|\bbg\b/],
  ["surface", /\bsurface|card|panel\b/],
  ["text", /\btext|foreground|ink|body copy\b/],
  ["muted", /\bmuted|neutral|gr[ae]y\b/],
  ["border", /\bborder|divider|outline|line\b/],
  ["danger", /\bdanger|error|destructive|red\b/],
  ["success", /\bsuccess|positive|green\b/],
  ["warning", /\bwarning|caution|amber|yellow\b/],
  ["info", /\binfo|blue\b/],
];

const MODE_WORDS: Array<[string, RegExp]> = [
  ["operate", /dashboard|admin|console|workflow|internal tool|saas product|\bapp\b|productivity/gi],
  ["read", /documentation|\bdocs\b|\bblog\b|article|reading|editorial|knowledge base/gi],
  ["persuade", /landing|marketing|conversion|launch|pricing|waitlist/gi],
  ["experience", /portfolio|agency|immersive|gallery|studio|brand experience/gi],
];

const LIBRARIES: Array<[string, string, RegExp, string]> = [
  ["components", "components", /shadcn/i, "shadcn/ui"],
  ["components", "components", /radix/i, "Radix UI"],
  ["icons", "icons", /lucide/i, "lucide"],
  ["icons", "icons", /material (symbols|icons)/i, "material symbols"],
  ["icons", "icons", /phosphor/i, "phosphor"],
  ["icons", "icons", /iconify/i, "iconify"],
  ["fonts", "fonts", /fontsource/i, "fontsource"],
  ["fonts", "fonts", /google fonts/i, "google fonts"],
];

const kebab = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function cleanLabel(text: string): string {
  return text
    .replace(/[`*_|>#]/g, " ")
    .replace(/^[\s\-+•\d.)]+/, "")
    .replace(/[\s:=\-–—(]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roleOf(label: string): string | undefined {
  const lower = label.toLowerCase();
  return ROLE_WORDS.find(([, pattern]) => pattern.test(lower))?.[0];
}

function extractColors(lines: string[]): Array<[string, string]> {
  const found = new Map<string, string>();
  for (const line of lines) {
    for (const match of line.matchAll(COLOR)) {
      const index = match.index ?? 0;
      let label = cleanLabel(line.slice(0, index));
      if (!label)
        label = cleanLabel(line.slice(index + match[0].length))
          .split(" ")
          .slice(0, 3)
          .join(" ");
      if (!label) continue;
      const role = roleOf(label) ?? kebab(label.split(" ").slice(-3).join(" "));
      if (!role) continue;
      let key = role;
      for (let n = 2; found.has(key); n++) key = `${role}-${n}`;
      found.set(key, match[0]);
    }
  }
  return [...found];
}

function roleFor(clause: string, fonts: Record<string, string>): string {
  const lower = clause.toLowerCase();
  if (/mono|code/.test(lower)) return "code";
  if (/heading|display|headline|title/.test(lower)) return "heading";
  if (/body|text|paragraph|copy/.test(lower)) return "body";
  return fonts.heading ? "body" : "heading";
}

function extractFonts(lines: string[], known: Set<string> | undefined): Record<string, string> {
  const fonts: Record<string, string> = {};
  const assign = (clause: string, family: string) => {
    if (Object.values(fonts).includes(family)) return;
    const role = roleFor(clause, fonts);
    if (!fonts[role]) fonts[role] = family;
  };
  for (const line of lines) {
    if (!/font|typeface|typograph|heading|display|body|sans|serif|mono|headline/i.test(line))
      continue;
    const explicit =
      /(heading|display|headline|title|body|text)\s*(?:font|typeface)?\s*[:\-–—]\s*\**([A-Z][A-Za-z0-9]*(?: [A-Z0-9][A-Za-z0-9]*){0,2})/.exec(
        line,
      );
    if (explicit?.[1] && explicit[2]) assign(explicit[1], explicit[2]);
    if (!known) continue;
    const words = [...line.matchAll(/[A-Za-z0-9][A-Za-z0-9'-]*/g)];
    for (let size = 3; size >= 1; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        const group = words.slice(i, i + size);
        const joined = group.map((w) => w[0]).join(" ");
        const first = group[0];
        const last = group[group.length - 1];
        if (!first || !last || first.index === undefined || last.index === undefined) continue;
        const contiguous = line.slice(first.index, last.index + last[0].length) === joined;
        if (!contiguous || !/^[A-Z]/.test(joined) || !known.has(joined.toLowerCase())) continue;
        const clause = line.slice(0, first.index).split(/[.;]/).pop() ?? "";
        assign(clause, joined);
      }
    }
  }
  return fonts;
}

function firstDimension(lines: string[], keywords: RegExp, unit: RegExp): string | undefined {
  for (const line of lines) {
    const keyword = keywords.exec(line);
    if (!keyword) continue;
    const match = unit.exec(line.slice(keyword.index + keyword[0].length));
    if (match) return match[0];
  }
  return undefined;
}

export function normalizeDirection(
  source: string,
  options: NormalizeOptions = {},
): NormalizeResult {
  const lines = source.split("\n");
  const title = lines.map((l) => /^#\s+(.+)$/.exec(l)?.[1]).find(Boolean);
  const name =
    title
      ?.replace(
        /\s*(design system|design direction|design language|direction|brand guidelines)\s*$/i,
        "",
      )
      .trim() || "Untitled";
  const description = lines
    .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("|") && !/^[-*]\s/.test(l.trim()))
    ?.trim()
    .slice(0, 240);

  const colors = extractColors(lines);
  const fonts = extractFonts(lines, options.knownFamilies);
  const radius = firstDimension(lines, /radius|rounded|corner/i, /\d+(\.\d+)?(px|rem)/);
  const unit = firstDimension(lines, /spacing|base unit|grid|gap/i, /\d+(\.\d+)?px/);

  const scores = MODE_WORDS.map(
    ([mode, pattern]) => [mode, (source.match(pattern) ?? []).length] as const,
  );
  const top = [...scores].sort((a, b) => b[1] - a[1]);
  const mode = top[0] && top[0][1] > 0 && top[0][1] > (top[1]?.[1] ?? 0) ? top[0][0] : undefined;

  const libraries: Record<string, string> = {};
  for (const [slot, , pattern, value] of LIBRARIES) {
    if (!libraries[slot] && pattern.test(source)) libraries[slot] = value;
  }

  const colorMap: Record<string, string> = Object.fromEntries(colors);
  const roles = Object.keys(colorMap);
  const missingColors: string[] = [];
  if (!roles.some((r) => r === "surface" || r === "background")) {
    colorMap.surface = "<hex>";
    missingColors.push("surface");
  }
  if (!roles.some((r) => r === "text")) {
    colorMap.text = "<hex>";
    missingColors.push("text");
  }
  if (!roles.includes("primary")) {
    colorMap.primary = "<hex>";
    missingColors.push("primary");
  }

  const type = (family: string | undefined, size: string, weight: number, lineHeight: number) => ({
    fontFamily: family ?? "<family>",
    fontSize: size,
    fontWeight: weight,
    lineHeight,
  });
  const frontmatter: Record<string, unknown> = {
    name,
    description: description ?? "<One sentence: what the product is and who it is for>",
    colors: colorMap,
    typography: {
      heading: type(fonts.heading, "<rem>", 600, 1.2),
      body: type(fonts.body, "1rem", 400, 1.6),
      ...(fonts.code ? { code: type(fonts.code, "0.875rem", 400, 1.5) } : {}),
    },
    rounded: { md: radius ?? "<px>" },
    spacing: { unit: unit ?? "<px>" },
    northstar: {
      mode: mode ?? "<operate | read | persuade | experience>",
      stack: options.stack ?? "<react | next | vue | svelte | angular | solid | html>",
      libraries: {
        components: libraries.components ?? "<for example shadcn/ui>",
        icons: libraries.icons ?? "<for example lucide>",
        fonts: libraries.fonts ?? "<for example fontsource>",
      },
      allow: [],
      ignore: [],
    },
  };

  const colorLines = colors.length
    ? colors.map(([role, value]) => `- ${role}: ${value}`).join("\n")
    : "Name each colour by role and keep to four to six roles.";
  const markdown = [
    "---",
    stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    `# ${name} design system`,
    "",
    "## Overview",
    "",
    description ??
      "Describe the product, the audience and the chosen direction in a short paragraph.",
    "",
    "## Colors",
    "",
    colorLines,
    "",
    "## Typography",
    "",
    Object.keys(fonts).length
      ? Object.entries(fonts)
          .map(([role, family]) => `- ${role}: ${family}`)
          .join("\n")
      : "Describe each type role and the families chosen through the font resolver.",
    "",
    "## Layout",
    "",
    "Describe the grid, the base spacing unit, the density and how the layout changes across widths.",
    "",
    "## Elevation & Depth",
    "",
    "Describe how depth is expressed and what never gets a shadow.",
    "",
    "## Shapes",
    "",
    "Describe the radius scale and the icon style.",
    "",
    "## Components",
    "",
    "List the components in use, the library each comes from, and the states each must support.",
    "",
    "## Do's and Don'ts",
    "",
    "| Do | Don't |",
    "|---|---|",
    "| Use tokens by reference | Write raw colour or spacing values in code |",
    "",
    "## Imported direction",
    "",
    "The original direction this system was drafted from, kept verbatim.",
    "",
    source.trim(),
    "",
  ].join("\n");

  const missing: string[] = [];
  if (missingColors.length) missing.push(`colors: ${missingColors.join(", ")}`);
  if (!fonts.heading) missing.push("typography: heading family");
  if (!fonts.body) missing.push("typography: body family");
  if (!mode) missing.push("mode");
  if (!options.stack) missing.push("stack");
  for (const slot of ["components", "icons", "fonts"]) {
    if (!libraries[slot]) missing.push(`libraries: ${slot}`);
  }
  if (!radius) missing.push("rounded: radius scale");
  if (!unit) missing.push("spacing: base unit");

  const questions: string[] = [];
  if (!mode)
    questions.push(
      "Which mode fits: operate, read, persuade or experience? Default: operate for an app, persuade for a marketing page.",
    );
  if (missingColors.length)
    questions.push(
      `Which colours should fill ${missingColors.join(", ")}? Default: derive them from the primary you already have, tinted neutrals for surface and text.`,
    );
  if (!fonts.heading || !fonts.body)
    questions.push(
      "Which fonts? Default: let resolve_font propose a pairing from the mood in the direction.",
    );

  return {
    markdown,
    report: {
      extracted: {
        name: title ? name : undefined,
        colors: colors.map(([role]) => role),
        fonts: Object.keys(fonts),
        mode,
        libraries: Object.keys(libraries),
        rounded: Boolean(radius),
        spacing: Boolean(unit),
      },
      missing,
      questions: questions.slice(0, 3),
    },
  };
}
