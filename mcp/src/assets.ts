import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Canon, loadCanon } from "@northstar/canon";

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
