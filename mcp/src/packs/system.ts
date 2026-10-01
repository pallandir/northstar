import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Canon } from "@northstar/canon";
import { type DesignData, type Row, search } from "@northstar/data";
import {
  type ExportFormat,
  type Issue,
  exportDesign,
  normalizeDirection,
  validateDesign,
} from "@northstar/design-md";
import { z } from "zod";
import { resolveInside } from "../lib/paths.js";
import { SCAFFOLDS, scaffold } from "../lib/scaffold.js";
import { inspectProject } from "../project.js";
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

  registry.register(
    "system",
    "design_system_propose",
    {
      description:
        "Draft a DESIGN.md for a product from the curated data: a palette for the product type, a font pairing for the mood, and a style. Candidates with a canon caution are skipped when an alternative exists. Returns a draft plus validation, never writes. Show it to the designer, ask what to change, then save it.",
      inputSchema: {
        product: z.string().min(2).max(120),
        mood: z.string().max(200).optional(),
        mode: modeSchema.optional(),
      },
    },
    async ({ product, mood, mode }) => {
      const palette = pick(search(data(), { domain: "palettes", query: product, mode, limit: 5 }));
      const pairing = pick(
        search(data(), { domain: "typography", query: mood ?? product, mode, limit: 5 }),
      );
      const style = pick(
        search(data(), {
          domain: "styles",
          query: `${mood ?? ""} ${product}`.trim(),
          mode,
          limit: 5,
        }),
      );
      const reasoning = pick(search(data(), { domain: "reasoning", query: product, limit: 3 }));
      if (!palette)
        return error(`No palette found for "${product}". Ask the designer for brand colours.`);

      const f = palette.fields;
      const direction = [
        `# ${product}`,
        "",
        `A design system for ${product}.`,
        "",
        ...(
          [
            ["Primary", f.primary],
            ["On primary", f.onPrimary],
            ["Accent", f.accent],
            ["Background", f.background],
            ["Text", f.foreground],
            ["Muted", f.muted],
            ["Border", f.border],
            ["Danger", f.destructive],
          ] as Array<[string, string | undefined]>
        )
          .filter(([, value]) => value)
          .map(([label, value]) => `- ${label}: ${value}`),
        "",
        pairing
          ? `Headings use ${pairing.fields.heading}. Body copy is set in ${pairing.fields.body}.`
          : "",
        mode ? `This is a ${mode} design.` : "",
      ].join("\n");

      const stack = inspectProject(root).stack;
      const choice = (need: string) => {
        const key = findNeed(canon, need);
        return key ? stackChoice(canon, key, stack)?.choice : undefined;
      };
      const { markdown, report } = normalizeDirection(direction, {
        knownFamilies: known(),
        stack,
        defaults: {
          rounded: "8px",
          spacing: "4px",
          headingSize: "2rem",
          libraries: { components: choice("dialog"), icons: choice("icon"), fonts: choice("font") },
        },
      });
      const validation = validateDesign(markdown, options);
      const notes = [
        `palette: ${palette.id}${palette.caution ? ` (caution: ${palette.caution})` : ""}`,
        pairing
          ? `pairing: ${pairing.id}${pairing.caution ? ` (caution: ${pairing.caution})` : ""}`
          : "pairing: none found",
        style
          ? `style: ${style.id}${style.caution ? ` (caution: ${style.caution})` : ""}`
          : "style: none found",
        reasoning
          ? `anti patterns to avoid: ${reasoning.fields.antiPatterns ?? "none listed"}`
          : "",
        `mode (inferred, confirm with the designer): ${report.extracted.mode ?? "not inferred"}`,
        `assumed defaults, change if the brief says otherwise: ${report.assumed.join("; ") || "none"}`,
        `still missing: ${report.missing.join("; ") || "nothing"}`,
        `validation: ready ${validation.ready}, errors ${validation.issues.filter((i) => i.severity === "error").length}`,
        ...validation.issues
          .filter((i) => i.severity === "error")
          .map((i) => `  ${i.path}: ${i.message}`),
      ].filter(Boolean);
      return text(`${notes.join("\n")}\n\n${markdown}`);
    },
  );
}
