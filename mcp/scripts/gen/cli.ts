import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drift, generate, write } from "./gen.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outputs = generate(repoRoot);

if (process.argv.includes("--check")) {
  const problems = drift(repoRoot, outputs);
  if (problems.length) {
    process.stderr.write(
      `generated files are out of date, run npm run gen\n${problems.join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${outputs.size} generated files are current\n`);
} else {
  write(repoRoot, outputs);
  process.stdout.write(`wrote ${outputs.size} files\n`);
}
