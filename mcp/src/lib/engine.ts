import {
  type BlendPart,
  type Canon,
  type Mode,
  type Seeds,
  buildCatalog,
  findInCatalog,
  resolveStyle,
} from "@northstar/canon";
import {
  type Issue,
  chromaOfHex,
  generateTokens,
  hueOfHex,
  renderDesign,
  validateDesign,
} from "@northstar/design-md";

export interface SystemRequest {
  name: string;
  description: string;
  mode?: Mode;
  archetype?: string;
  secondary?: string;
  takes?: BlendPart[];
  brand?: string;
  overrides?: Partial<Seeds>;
  query: string;
  stack: string;
  libraries: { components: string; icons: string; fonts: string };
}

export interface BuiltSystem {
  markdown: string;
  notes: string[];
  issues: Issue[];
  ready: boolean;
}

const catalogs = new WeakMap<Canon, ReturnType<typeof buildCatalog>>();

function catalogOf(canon: Canon) {
  let entries = catalogs.get(canon);
  if (!entries) {
    entries = buildCatalog(canon);
    catalogs.set(canon, entries);
  }
  return entries;
}

export function pickArchetype(canon: Canon, query: string, mode?: Mode): string {
  const hits = findInCatalog(catalogOf(canon), canon, query, {
    kind: "archetype",
    stage: "direction",
    limit: 8,
    budget: 4000,
  }).hits;
  for (const hit of hits) {
    const id = hit.id.slice("arch:".length);
    const archetype = canon.archetypes.archetypes.find((a) => a.id === id);
    if (archetype && (!mode || archetype.modes.includes(mode))) return id;
  }
  const ids = canon.archetypes.archetypes
    .filter((a) => !mode || a.modes.includes(mode))
    .map((a) => a.id)
    .join(", ");
  throw new Error(
    `no archetype matches "${query}"${mode ? ` for ${mode}` : ""}. Ask the designer which look they want and pass archetype, one of ${ids}`,
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function buildSystem(
  canon: Canon,
  knownFonts: Set<string>,
  request: SystemRequest,
): BuiltSystem {
  const notes: string[] = [];
  const chosen = request.archetype ?? pickArchetype(canon, request.query, request.mode);
  if (!request.archetype) {
    notes.push(`archetype: ${chosen} (chosen from the brief, pass archetype to change it)`);
  } else notes.push(`archetype: ${chosen}`);
  const style = resolveStyle(canon, chosen, request.secondary, request.takes);
  if (style.secondary) {
    notes.push(`blend: ${style.secondary.id} contributes ${style.takes.join(" and ")}`);
  }
  const mode = request.mode ?? style.primary.modes[0];
  if (!mode) throw new Error(`archetype ${chosen} lists no modes, fix canon/archetypes.yaml`);
  if (!request.mode) {
    notes.push(`mode (taken from the archetype, confirm with the designer): ${mode}`);
  } else if (!style.primary.modes.includes(mode)) {
    notes.push(
      `warning: ${chosen} suits ${style.primary.modes.join(", ")}, you asked for ${mode}, so check the direction still fits`,
    );
  }

  const seeds: Seeds = { ...style.seeds, ...request.overrides };
  if (request.brand) {
    seeds.hue = hueOfHex(request.brand);
    seeds.chroma = clamp(chromaOfHex(request.brand), 0.04, 0.22);
    notes.push(
      `brand ${request.brand} seeds hue ${Math.round(seeds.hue)} and chroma ${seeds.chroma.toFixed(2)}, the tokens are derived from it and not copied`,
    );
  }
  for (const font of Object.values(style.fonts)) {
    if (!knownFonts.has(font.toLowerCase())) {
      throw new Error(
        `font ${font} from archetype ${chosen} is not in the font data, fix canon/archetypes.yaml or call resolve_font`,
      );
    }
  }

  const tokens = generateTokens({ seeds, fonts: style.fonts, mode });
  const markdown = renderDesign(tokens, {
    name: request.name,
    description: request.description,
    mode,
    stack: request.stack,
    libraries: request.libraries,
    archetype: {
      primary: style.primary.id,
      ...(style.secondary ? { secondary: style.secondary.id, takes: style.takes } : {}),
    },
    dials: style.primary.dials,
    summary: style.primary.summary,
    depth: style.primary.depth,
    layout: style.primary.layout,
  });
  const validation = validateDesign(markdown, {
    rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })),
    archetypes: canon.archetypes.archetypes.map((a) => a.id),
  });
  return { markdown, notes, issues: validation.issues, ready: validation.ready };
}
