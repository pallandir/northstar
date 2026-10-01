import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  type Arbitration,
  type Libraries,
  MODES,
  type Mode,
  type Rubric,
  type Rule,
  type Severity,
  arbitrationSchema,
  librariesSchema,
  rubricSchema,
  ruleListSchema,
} from "./schema.js";

export const REFERENCE_MAX_LINES = 300;

export interface Reference {
  topic: string;
  title: string;
  loadWhen: string;
  body: string;
}

export interface Canon {
  root: string;
  rules: Rule[];
  libraries: Libraries;
  rubric: Rubric;
  arbitration: Arbitration;
  references: Reference[];
  framework: string;
}

export function defaultCanonRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}

function loadReferences(dir: string): Reference[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const body = readFileSync(join(dir, name), "utf8");
      const lines = body.split("\n");
      const title = lines[0]?.replace(/^#\s*/, "") ?? name;
      const loadWhen =
        lines
          .find((line) => line.startsWith("Load when:"))
          ?.slice(10)
          .trim() ?? "";
      return { topic: name.replace(/\.md$/, ""), title, loadWhen, body };
    });
}

export function loadCanon(root: string = defaultCanonRoot()): Canon {
  const ruleFiles = readdirSync(join(root, "rules"))
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  const rules = ruleFiles.flatMap((name) =>
    ruleListSchema.parse(readYaml(join(root, "rules", name))),
  );
  const frameworkPath = join(root, "framework.md");
  return {
    root,
    rules,
    libraries: librariesSchema.parse(readYaml(join(root, "libraries.yaml"))),
    rubric: rubricSchema.parse(readYaml(join(root, "rubric.yaml"))),
    arbitration: arbitrationSchema.parse(readYaml(join(root, "arbitration.yaml"))),
    references: loadReferences(join(root, "references")),
    framework: existsSync(frameworkPath) ? readFileSync(frameworkPath, "utf8") : "",
  };
}

export function severityFor(rule: Rule, mode: Mode): Severity {
  return rule.modes?.[mode] ?? rule.severity;
}

export function validateCanon(canon: Canon): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const rule of canon.rules) {
    if (ids.has(rule.id)) problems.push(`duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    if (
      !rule.allowable &&
      Object.values(rule.modes ?? {}).some((s) => s === "off" || s === "info")
    ) {
      problems.push(`${rule.id} is not allowable but a mode lowers its severity`);
    }
  }

  for (const conflict of canon.arbitration.conflicts) {
    for (const id of conflict.rules) {
      if (!ids.has(id)) problems.push(`arbitration ${conflict.id} names unknown rule ${id}`);
    }
  }

  const dimensions = Object.keys(canon.rubric.dimensions);
  for (const mode of MODES) {
    const weights = canon.rubric.weights[mode];
    if (!weights) {
      problems.push(`rubric has no weights for ${mode}`);
      continue;
    }
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total !== 100) problems.push(`rubric weights for ${mode} sum to ${total}`);
    for (const key of Object.keys(weights)) {
      if (!dimensions.includes(key)) problems.push(`rubric weight ${key} is not a dimension`);
    }
  }

  for (const reference of canon.references) {
    const lines = reference.body.split("\n").length;
    if (lines > REFERENCE_MAX_LINES) {
      problems.push(`reference ${reference.topic} has ${lines} lines`);
    }
    if (!reference.loadWhen) problems.push(`reference ${reference.topic} lacks a Load when line`);
    if (/[–—]/.test(reference.body)) {
      problems.push(`reference ${reference.topic} contains a dash separator`);
    }
  }

  for (const [need, entry] of Object.entries(canon.libraries.needs)) {
    for (const stack of Object.keys(entry)) {
      if (["covers", "alternatives"].includes(stack)) continue;
      if (!(stack in canon.libraries.stacks))
        problems.push(`need ${need} names unknown stack ${stack}`);
    }
  }

  return problems;
}
