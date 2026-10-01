import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(mcpRoot, "..");
const assets = join(mcpRoot, "dist", "assets");

const canonRoot = join(repoRoot, "canon");
const skip = ["node_modules", "tests", "src", "package.json", "tsconfig.json"];

rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

cpSync(canonRoot, join(assets, "canon"), {
  recursive: true,
  filter: (source) => !skip.some((name) => relative(canonRoot, source).split(sep).includes(name)),
});
cpSync(join(repoRoot, "plugin", "skills", "northstar"), join(assets, "skill"), {
  recursive: true,
});
cpSync(join(repoRoot, "packages", "data", "json"), join(assets, "data"), { recursive: true });
cpSync(
  join(repoRoot, "packages", "data", "LICENSE-ui-ux-pro-max.txt"),
  join(assets, "data", "LICENSE-ui-ux-pro-max.txt"),
);
