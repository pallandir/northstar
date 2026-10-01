import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const workspaces = [
  "canon",
  "mcp",
  ...["packages", "extensions"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(root, group, entry.name, "package.json")),
      )
      .map((entry) => `${group}/${entry.name}`),
  ),
];

const watchers = workspaces
  .map((dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")))
  .filter((pkg) => pkg.scripts?.dev)
  .map((pkg) => pkg.name);

if (!watchers.length) {
  console.error("No workspace defines a dev script.");
  process.exit(1);
}

const children = watchers.map((name) => {
  const child = spawn("npm", ["run", "dev", "--workspace", name], { cwd: root, stdio: "inherit" });
  child.on("exit", (code) => {
    if (code) {
      console.error(`${name} stopped with exit code ${code}`);
      for (const other of children) other.kill();
      process.exit(code);
    }
  });
  return child;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
