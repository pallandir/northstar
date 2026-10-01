import { execFileSync } from "node:child_process";

const LIMIT_BYTES = 3 * 1024 * 1024;
const REQUIRED = [
  "dist/cli.js",
  "dist/index.js",
  "dist/assets/canon/framework.md",
  "dist/assets/skill/SKILL.md",
];

const output = execFileSync(
  "npm",
  ["pack", "--workspace", "@pallandir/northstar", "--dry-run", "--json"],
  { encoding: "utf8" },
);
const [pack] = JSON.parse(output);
const paths = new Set(pack.files.map((file) => file.path));
const missing = REQUIRED.filter((path) => !paths.has(path));

if (missing.length) {
  console.error(`package is missing ${missing.join(", ")}`);
  process.exit(1);
}
if (pack.unpackedSize > LIMIT_BYTES) {
  console.error(`package is ${pack.unpackedSize} bytes unpacked, the limit is ${LIMIT_BYTES}`);
  process.exit(1);
}
console.log(
  `package ok: ${pack.files.length} files, ${Math.round(pack.unpackedSize / 1024)} KB unpacked`,
);
