import { VERSION } from "./config.js";

type Command = (args: string[]) => Promise<number | undefined>;

const commands: Record<string, () => Promise<Command>> = {
  init: async () => (await import("./cli/init.js")).init,
  detect: async () => (await import("./cli/detect.js")).detect,
  hook: async () => (await import("./cli/hook.js")).hook,
};

const USAGE = `northstar ${VERSION}

Usage: northstar [command]

Commands:
  serve       start the MCP server over stdio (default)
  init [dir]  write DESIGN.md, PRODUCT.md and design/decisions.md, never overwriting
  detect      scan UI files for generic AI patterns, exits 1 on errors
  hook        agent hook entry point, never fails an edit
  --version   print the version`;

async function run(argv: string[]): Promise<number> {
  const [name, ...args] = argv;

  if (name === undefined || name === "serve") {
    await import("./index.js");
    return -1;
  }
  if (name === "--version" || name === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (name === "--help" || name === "-h" || name === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const load = commands[name];
  if (!load) {
    process.stderr.write(`unknown command: ${name}\n\n${USAGE}\n`);
    return 2;
  }
  const command = await load();
  return (await command(args)) ?? 0;
}

run(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: Error) => {
    process.stderr.write(`[northstar] ${err.message}\n`);
    process.exitCode = 1;
  },
);
