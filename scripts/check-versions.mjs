import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));

const expected = readJson("package.json").version;
const found = [];

const record = (label, version) => found.push({ label, version });

const manifests = [
  "mcp/package.json",
  "canon/package.json",
  ...readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => `packages/${entry.name}/package.json`),
  ...readdirSync(join(root, "extensions"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "extensions", entry.name, "package.json")),
    )
    .map((entry) => `extensions/${entry.name}/package.json`),
];
for (const path of manifests) record(path, readJson(path).version);

const plugin = readJson("plugin/.claude-plugin/plugin.json");
record("plugin/.claude-plugin/plugin.json", plugin.version);

const marketplace = readJson(".claude-plugin/marketplace.json");
record(".claude-plugin/marketplace.json metadata", marketplace.metadata?.version);
for (const entry of marketplace.plugins ?? []) {
  record(`.claude-plugin/marketplace.json plugin ${entry.name}`, entry.version);
}

const literals = [
  ["mcp/src/config.ts", /export const VERSION\s*=\s*"([^"]+)"/],
  ["extensions/core/manifest.base.ts", /export const version\s*=\s*"([^"]+)"/],
];
for (const [path, pattern] of literals) {
  const match = pattern.exec(read(path));
  if (match) {
    record(path, match[1]);
  } else if (!read(path).includes("package.json")) {
    record(path, "no version literal and no package.json import");
  }
}

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1];
  if (!tag) {
    console.error("--tag needs a value such as v2.3.0");
    process.exit(1);
  }
  record(`git tag ${tag}`, tag.replace(/^v/, ""));
}

const drift = found.filter((entry) => entry.version !== expected);
if (drift.length) {
  console.error(`Version drift. The root package.json says ${expected}.`);
  for (const entry of drift) console.error(`  ${entry.label}: ${entry.version}`);
  console.error("Set every version to the root version, then run npm run gen.");
  process.exit(1);
}
console.log(`versions ok: ${found.length} places at ${expected}`);
