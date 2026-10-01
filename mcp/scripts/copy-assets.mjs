import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(mcpRoot, "..");
const assets = join(mcpRoot, "dist", "assets");

const skip = ["node_modules", "tests", "src", "package.json", "tsconfig.json"];

rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

cpSync(join(repoRoot, "canon"), join(assets, "canon"), {
  recursive: true,
  filter: (source) => !skip.some((name) => source.split("/").includes(name)),
});
cpSync(join(repoRoot, "plugin", "skills", "northstar"), join(assets, "skill"), {
  recursive: true,
});
cpSync(join(repoRoot, "packages", "data", "json"), join(assets, "data"), { recursive: true });
