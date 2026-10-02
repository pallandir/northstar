import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Canon, loadCanon } from "@northstar/canon";
import { type DesignData, loadData } from "./data/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function locate(label: string, envName: string, marker: string, bundled: string[]): string {
  const override = process.env[envName];
  if (override) {
    if (!existsSync(join(override, marker))) {
      throw new Error(
        `${envName} is ${override} but it has no ${marker}, fix the variable or unset it`,
      );
    }
    return override;
  }
  const found = bundled.find((path) => existsSync(join(path, marker)));
  if (!found) throw new Error(`northstar ${label} assets not found, reinstall the package`);
  return found;
}

export function canonRoot(): string {
  return locate("canon", "NORTHSTAR_CANON_ROOT", "rules", [
    join(here, "assets", "canon"),
    join(here, "..", "..", "canon"),
  ]);
}

let cached: Canon | undefined;

export function getCanon(): Canon {
  cached ??= loadCanon(canonRoot());
  return cached;
}

function dataRoot(): string {
  return locate("design data", "NORTHSTAR_DATA_ROOT", "manifest.json", [
    join(here, "assets", "data"),
    join(here, "..", "data", "json"),
  ]);
}

let cachedData: DesignData | undefined;

export function getData(): DesignData {
  cachedData ??= loadData(dataRoot());
  return cachedData;
}

export function skillRoot(name: string): string {
  const base = locate("skills", "NORTHSTAR_SKILLS_ROOT", join(name, "SKILL.md"), [
    join(here, "assets", "skills"),
    join(here, "..", "..", "plugin", "skills"),
  ]);
  return join(base, name);
}
