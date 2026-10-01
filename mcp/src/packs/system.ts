import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BLEND_PARTS, type Canon, DENSITIES, FEELS, SHAPES, TEMPERATURES } from "@northstar/canon";
import { type DesignData, type Row, search } from "@northstar/data";
import {
  type ExportFormat,
  type Issue,
  exportDesign,
  normalizeDirection,
  validateDesign,
} from "@northstar/design-md";
import { z } from "zod";
import { buildSystem } from "../lib/engine.js";
import { resolveInside } from "../lib/paths.js";
import { SCAFFOLDS, scaffold } from "../lib/scaffold.js";
import { type StackName, inspectProject } from "../project.js";
import type { PackRegistry } from "./registry.js";
import { findNeed, stackChoice } from "./resolve.js";
import { error, modeSchema, text } from "./util.js";

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function formatIssues(issues: Issue[]): string {
  if (!issues.length) return "No issues.";
  return issues
    .map(
      (i) => `${i.severity} ${i.path || "document"}: ${i.message}${i.rule ? ` (${i.rule})` : ""}`,
    )
    .join("\n");
}

function pick(rows: Row[]): Row | undefined {
  return rows.find((row) => !row.caution) ?? rows[0];
}

export function registerSystem(
  registry: PackRegistry,
  canon: Canon,
  data: () => DesignData,
  root: string,
): void {
  const options = {
    rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })),
    defaultFamilies: (canon.rules.find((r) => r.id === "NS-TYPE-DEFAULT-DISPLAY")?.params
      ?.families ?? []) as string[],
    archetypes: canon.archetypes.archetypes.map((a) => a.id),
  };
  const known = () => new Set(data().rows.fonts.map((row) => row.name.toLowerCase()));
  const designPath = join(root, "DESIGN.md");

  registry.register(
    "system",
    "design_md_init",
    {
      description:
        "Scaffold DESIGN.md, PRODUCT.md and design/decisions.md from the templates. Never overwrites an existing file unless force is true. Fill the placeholders by asking the designer, or draft from a direction with design_md_normalize.",
      inputSchema: { force: z.boolean().optional() },
    },
    async ({ force }) => {
      const { created, skipped } = scaffold(root, force ?? false);
      return text(
        `created: ${created.join(", ") || "none"}\nkept: ${skipped.join(", ") || "none"}\nscaffolds: ${SCAFFOLDS.map((s) => s.target).join(", ")}`,
      );
    },
  );

  registry.register(
    "system",
    "design_md_validate",
    {
      description:
        "Validate DESIGN.md: required tokens, references, colour and dimension formats, WCAG contrast of the colour pairs, the northstar block against the canon, palette size and font count. Fix every error, warnings are advice.",
      inputSchema: { path: z.string().max(300).optional() },
    },
    async ({ path }) => {
      try {
        const file = join(root, resolveInside(root, path ?? "DESIGN.md"));
        const source = await readIfExists(file);
        if (source === null)
          return error("DESIGN.md does not exist. Run design_md_init or design_md_normalize.");
        const result = validateDesign(source, options);
        const head = `ready: ${result.ready}. placeholders: ${result.placeholders}.`;
        return text(`${head}\n${formatIssues(result.issues)}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "system",
    "design_md_normalize",
    {
      description:
        "Turn any freeform design direction markdown into a DESIGN.md draft. Pass source text, or a path to a markdown file in the project. Extracts colours, fonts, radius, spacing, mode and libraries, keeps the original text verbatim, and reports what is missing plus at most three questions with defaults. With write true it creates DESIGN.md only when none exists.",
      inputSchema: {
        source: z.string().max(60_000).optional(),
        path: z.string().max(300).optional(),
        write: z.boolean().optional(),
      },
    },
    async ({ source, path, write }) => {
      try {
        let input = source;
        if (!input && path) {
          const file = join(root, resolveInside(root, path));
          const content = await readIfExists(file);
          if (content === null) return error(`No file at ${path}.`);
          input = content;
        }
        if (!input) return error("Pass source text or a path to a markdown file.");

        const { markdown, report } = normalizeDirection(input, {
          knownFamilies: known(),
          stack: inspectProject(root).stack,
        });
        const summary = [
          `extracted: ${JSON.stringify(report.extracted)}`,
          `missing: ${report.missing.join("; ") || "nothing"}`,
          `questions: ${report.questions.map((q, i) => `${i + 1}. ${q}`).join(" ") || "none"}`,
        ].join("\n");

        if (write) {
          await mkdir(dirname(designPath), { recursive: true });
          try {
            await writeFile(designPath, markdown, { flag: "wx" });
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
            return error(
              "DESIGN.md already exists, it is never overwritten. Review the draft by calling without write.",
            );
          }
          return text(`Wrote DESIGN.md.\n${summary}`);
        }
        return text(`${summary}\n\n${markdown}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "system",
    "design_md_export",
    {
      description:
        "Export the tokens in DESIGN.md as css variables, a Tailwind v4 theme block, or W3C design tokens (DTCG 2025.10 object form). Returns the text, write it where the project keeps its tokens.",
      inputSchema: {
        format: z.enum(["css", "tailwind", "dtcg"]),
        path: z.string().max(300).optional(),
      },
    },
    async ({ format, path }) => {
      try {
        const file = join(root, resolveInside(root, path ?? "DESIGN.md"));
        const source = await readIfExists(file);
        if (source === null) return error("DESIGN.md does not exist.");
        return text(exportDesign(source, format as ExportFormat));
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  const libraryChoices = (stack: StackName) => {
    const choice = (need: string) => {
      const key = findNeed(canon, need);
      const picked = key ? stackChoice(canon, key, stack)?.choice : undefined;
      if (!picked) {
        throw new Error(
          `no ${stack} library mapping for ${need}, run resolve_library and pass the choice`,
        );
      }
      return picked;
    };
    return { components: choice("dialog"), icons: choice("icon"), fonts: choice("font") };
  };

  const archetypeIds = canon.archetypes.archetypes.map((a) => a.id).join(", ");
  const seedSchema = z
    .object({
      hue: z.number().min(0).max(360).optional(),
      chroma: z.number().min(0.02).max(0.3).optional(),
      temperature: z.enum(TEMPERATURES).optional(),
      shape: z.enum(SHAPES).optional(),
      density: z.enum(DENSITIES).optional(),
      feel: z.enum(FEELS).optional(),
    })
    .optional();

  registry.register(
    "system",
    "design_tokens_generate",
    {
      description: `Generate a complete, contrast checked DESIGN.md from an archetype instead of picking colours by hand: tinted neutral ramp, accent and status colours, light and dark themes, layered shadows, concentric radii, spacing, type scale with tracking and motion tokens. Archetypes: ${archetypeIds}. Blend with secondary and takes (surface, type, motion). brand seeds the hue from a hex. Returns the draft, never overwrites; write true creates DESIGN.md only when none exists. format also returns css, tailwind or dtcg.`,
      inputSchema: {
        archetype: z.string().min(2).max(40),
        mode: modeSchema,
        name: z.string().min(2).max(80),
        description: z.string().min(2).max(300),
        secondary: z.string().min(2).max(40).optional(),
        takes: z.array(z.enum(BLEND_PARTS)).max(3).optional(),
        brand: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        overrides: seedSchema,
        format: z.enum(["css", "tailwind", "dtcg"]).optional(),
        write: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        const stack = inspectProject(root).stack;
        const built = buildSystem(canon, known(), {
          name: input.name,
          description: input.description,
          mode: input.mode,
          archetype: input.archetype,
          secondary: input.secondary,
          takes: input.takes,
          brand: input.brand,
          overrides: input.overrides,
          query: input.archetype,
          stack,
          libraries: libraryChoices(stack),
        });
        if (input.write) {
          await mkdir(dirname(designPath), { recursive: true });
          try {
            await writeFile(designPath, built.markdown, { flag: "wx" });
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
            return error(
              "DESIGN.md already exists, it is never overwritten. Call without write to review the draft.",
            );
          }
        }
        const errors = built.issues.filter((i) => i.severity === "error");
        const lines = [
          ...built.notes,
          `validation: ready ${built.ready}, errors ${errors.length}`,
          ...errors.map((i) => `  ${i.path}: ${i.message}`),
          input.write ? "Wrote DESIGN.md." : "Not written. Show it to the designer, then save it.",
        ];
        const exported = input.format ? `\n\n${exportDesign(built.markdown, input.format)}` : "";
        return text(`${lines.join("\n")}\n\n${built.markdown}${exported}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "system",
    "design_system_propose",
    {
      description:
        "Draft a DESIGN.md for a product from a short brief. Picks an archetype that fits the product, mood and mode (or take one with archetype), then generates the tokens through design_tokens_generate. Returns a draft plus validation and the anti patterns for the category, never writes. Show it to the designer, ask what to change, then save it.",
      inputSchema: {
        product: z.string().min(2).max(120),
        mood: z.string().max(200).optional(),
        mode: modeSchema.optional(),
        archetype: z.string().min(2).max(40).optional(),
        brand: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      },
    },
    async ({ product, mood, mode, archetype, brand }) => {
      try {
        const stack = inspectProject(root).stack;
        const built = buildSystem(canon, known(), {
          name: product,
          description: `A design system for ${product}.`,
          mode,
          archetype,
          brand,
          query: `${mood ?? ""} ${product}`.trim(),
          stack,
          libraries: libraryChoices(stack),
        });
        const reasoning = pick(search(data(), { domain: "reasoning", query: product, limit: 3 }));
        const errors = built.issues.filter((i) => i.severity === "error");
        const notes = [
          ...built.notes,
          reasoning
            ? `anti patterns to avoid: ${reasoning.fields.antiPatterns ?? "none listed"}`
            : "",
          `validation: ready ${built.ready}, errors ${errors.length}`,
          ...errors.map((i) => `  ${i.path}: ${i.message}`),
        ].filter(Boolean);
        return text(`${notes.join("\n")}\n\n${built.markdown}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );
}
