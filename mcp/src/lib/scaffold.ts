import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonRoot } from "../assets.js";

interface Scaffold {
  template: string;
  target: string;
}

export const SCAFFOLDS: Scaffold[] = [
  { template: "DESIGN.template.md", target: "DESIGN.md" },
  { template: "PRODUCT.template.md", target: "PRODUCT.md" },
  { template: "decisions.template.md", target: "design/decisions.md" },
];

export interface InitResult {
  created: string[];
  skipped: string[];
}

export function scaffold(projectRoot: string, force = false): InitResult {
  const result: InitResult = { created: [], skipped: [] };
  const templates = join(canonRoot(), "templates");
  for (const { template, target } of SCAFFOLDS) {
    const destination = join(projectRoot, target);
    if (existsSync(destination) && !force) {
      result.skipped.push(target);
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(templates, template), "utf8"));
    result.created.push(target);
  }
  return result;
}
