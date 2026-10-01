import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Canon, loadCanon } from "@northstar/canon";
import { type DesignData, loadData } from "@northstar/data";

const here = dirname(fileURLToPath(import.meta.url));

export function canonRoot(): string {
  const candidates = [
    process.env.NORTHSTAR_CANON_ROOT,
    join(here, "assets", "canon"),
    join(here, "..", "..", "canon"),
  ];
  const found = candidates.find((path) => path && existsSync(join(path, "rules")));
  if (!found) throw new Error("northstar canon assets not found, reinstall the package");
  return found;
}

let cached: Canon | undefined;

export function getCanon(): Canon {
  cached ??= loadCanon(canonRoot());
  return cached;
}

export function dataRoot(): string {
  const candidates = [
    process.env.NORTHSTAR_DATA_ROOT,
    join(here, "assets", "data"),
    join(here, "..", "..", "packages", "data", "json"),
  ];
  const found = candidates.find((path) => path && existsSync(join(path, "manifest.json")));
  if (!found) throw new Error("northstar design data not found, reinstall the package");
  return found;
}

let cachedData: DesignData | undefined;

export function getData(): DesignData {
  cachedData ??= loadData(dataRoot());
  return cachedData;
}

export function skillRoot(): string {
  const candidates = [
    process.env.NORTHSTAR_SKILL_ROOT,
    join(here, "assets", "skill"),
    join(here, "..", "..", "plugin", "skills", "northstar"),
  ];
  const found = candidates.find((path) => path && existsSync(join(path, "SKILL.md")));
  if (!found) throw new Error("northstar skill assets not found, reinstall the package");
  return found;
}
