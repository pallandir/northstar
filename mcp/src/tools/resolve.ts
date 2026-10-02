import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Canon } from "@northstar/canon";
import { z } from "zod";
import { type DesignData, search } from "../data/index.js";
import { STACKS, type StackName, inspectProject } from "../project.js";
import { error, modeSchema, text } from "./util.js";

const stackSchema = z.enum(STACKS);

const kebab = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface StackChoice {
  choice: string;
  package?: string;
  install?: string;
  mcp?: string;
  modes?: string[];
}

export function findNeed(canon: Canon, query: string): string | undefined {
  const wanted = query.trim().toLowerCase();
  const needs = Object.entries(canon.libraries.needs);
  const exact = needs.find(
    ([name, need]) => name === wanted || need.covers.some((c) => c.toLowerCase() === wanted),
  );
  if (exact) return exact[0];
  return needs.find(
    ([name, need]) =>
      wanted.includes(name) || need.covers.some((c) => wanted.includes(c.toLowerCase())),
  )?.[0];
}

export function stackChoice(canon: Canon, need: string, stack: StackName): StackChoice | undefined {
  const entry = canon.libraries.needs[need] as Record<string, unknown> | undefined;
  if (!entry) return undefined;
  const parent = canon.libraries.stacks[stack]?.extends;
  const pick = (entry[stack] ?? (parent ? entry[parent] : undefined)) as StackChoice | undefined;
  return pick;
}

function fontPackages(name: string, axes: string | undefined): string {
  const slug = kebab(name);
  const variable = axes ? `@fontsource-variable/${slug}` : undefined;
  return variable
    ? `${variable} (or @fontsource/${slug} for static weights)`
    : `@fontsource/${slug}`;
}

export function registerResolve(
  server: McpServer,
  canon: Canon,
  data: () => DesignData,
  root: string,
): void {
  const stackOf = (stack?: StackName) => stack ?? inspectProject(root).stack;

  server.registerTool(
    "resolve_library",
    {
      description:
        "Pick the library for a UI need instead of hand rolling it. Needs include dialog, popover, menu, tooltip, select, tabs, toast, table, form, chart, icon, font, motion, carousel, command palette, smooth scroll. Detects the stack from the project unless given. Confirm the package with npm view before installing.",
      inputSchema: { need: z.string().min(2).max(80), stack: stackSchema.optional() },
    },
    async ({ need, stack }) => {
      const key = findNeed(canon, need);
      const resolvedStack = stackOf(stack);
      if (!key) {
        return error(
          `No library mapping for "${need}". Known needs: ${Object.keys(canon.libraries.needs).join(", ")}.`,
        );
      }
      const pick = stackChoice(canon, key, resolvedStack);
      if (!pick) {
        return error(
          `No ${resolvedStack} mapping for ${key}. Ask which library the project prefers.`,
        );
      }
      const entry = canon.libraries.needs[key] as { covers: string[]; alternatives?: string[] };
      const lines = [
        `need: ${key} (covers ${entry.covers.join(", ")})`,
        `stack: ${resolvedStack}`,
        `use: ${pick.choice}`,
      ];
      if (pick.package)
        lines.push(`package: ${pick.package}`, `verify: npm view ${pick.package} version`);
      if (pick.install) lines.push(`install: ${pick.install}`);
      if (pick.mcp) lines.push(`mcp: the ${pick.mcp} MCP can browse and add components`);
      if (pick.modes) lines.push(`only for modes: ${pick.modes.join(", ")}`);
      if (entry.alternatives?.length) lines.push(`alternatives: ${entry.alternatives.join(", ")}`);
      lines.push("Hand rolling this needs an explicit northstar.allow entry in DESIGN.md.");
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "resolve_font",
    {
      description:
        "Choose fonts from a mood instead of from memory, or verify that a family exists. Give role and mood to get curated pairings and candidate families with their Fontsource packages. Give family to check it exists and see its weights. Respect cautions: a training data default as a display face needs a reason.",
      inputSchema: {
        mood: z.string().min(2).max(200).optional(),
        mode: modeSchema.optional(),
        family: z.string().min(2).max(80).optional(),
        stack: stackSchema.optional(),
      },
    },
    async ({ mood, mode, family, stack }) => {
      if (family) {
        const match = data().rows.fonts.find(
          (row) => row.name.toLowerCase() === family.toLowerCase(),
        );
        if (!match) {
          const near = search(data(), { domain: "fonts", query: family, limit: 3 }).map(
            (r) => r.name,
          );
          return error(`No family named "${family}". Closest: ${near.join(", ") || "none"}.`);
        }
        const via =
          stackOf(stack) === "next"
            ? `import { ${match.name.replace(/ /g, "_")} } from "next/font/google"`
            : `npm install ${fontPackages(match.name, match.fields.axes).split(" ")[0]}`;
        return text(
          `${match.name}: ${match.summary}. weights ${match.fields.weights ?? "n/a"}. axes ${match.fields.axes ?? "none"}. popularity rank ${match.fields.rank ?? "n/a"}.\n${via}`,
        );
      }
      if (!mood) return error("Give a mood to search by, or a family to verify.");

      const pairings = search(data(), { domain: "typography", query: mood, mode, limit: 3 });
      const families = search(data(), { domain: "fonts", query: mood, limit: 5 });
      const lines = ["Pairings:"];
      for (const row of pairings) {
        lines.push(
          `- ${row.name}: ${row.fields.heading} with ${row.fields.body}. ${row.fields.bestFor ?? ""}`,
        );
        if (row.caution) lines.push(`  caution: ${row.caution}`);
      }
      lines.push("", "Families:");
      for (const row of families) {
        lines.push(`- ${row.name} (${row.summary}): ${fontPackages(row.name, row.fields.axes)}`);
      }
      lines.push(
        "",
        "Verify the pick with resolve_font family before writing CSS. Record the reason in DESIGN.md.",
      );
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "resolve_icon",
    {
      description:
        "Find icons for a need from the project's icon library instead of drawing SVG by hand. Returns the library package for the stack and curated candidates. Never invent an icon name: check it exists in the installed package.",
      inputSchema: {
        names: z.array(z.string().min(2).max(60)).min(1).max(10),
        stack: stackSchema.optional(),
      },
    },
    async ({ names, stack }) => {
      const resolvedStack = stackOf(stack);
      const pick = stackChoice(canon, "icon", resolvedStack);
      const lines = [`stack: ${resolvedStack}`];
      if (pick) lines.push(`library: ${pick.choice} (${pick.package})`);
      for (const name of names) {
        const rows = search(data(), { domain: "icons", query: name, limit: 3 });
        lines.push(`${name}:`);
        if (!rows.length)
          lines.push("  no curated candidate, search the installed package exports");
        for (const row of rows) {
          lines.push(
            `  - ${row.name} (${row.fields.library ?? "?"}) ${row.fields.importCode ?? ""}`.trimEnd(),
          );
        }
      }
      if (pick?.package) {
        lines.push(
          `verify: node -e "console.log(Object.keys(require('${pick.package}')).filter(k => /<name>/i.test(k)))"`,
        );
      }
      return text(lines.join("\n"));
    },
  );
}
