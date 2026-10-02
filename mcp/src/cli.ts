import { VERSION } from "./config.js";

type Command = (args: string[]) => Promise<number | undefined>;

const commands: Record<string, () => Promise<Command>> = {
  init: async () => (await import("./cli/init.js")).init,
  detect: async () => (await import("./cli/detect.js")).detect,
  capture: async () => (await import("./cli/page.js")).capture,
  audit: async () => (await import("./cli/page.js")).audit,
  hook: async () => (await import("./cli/hook.js")).hook,
  conflicts: async () => (await import("./cli/conflicts.js")).conflicts,
  install: async () => (await import("./cli/setup.js")).installCommand,
  uninstall: async () => (await import("./cli/setup.js")).uninstallCommand,
  doctor: async () => (await import("./cli/setup.js")).doctorCommand,
  run: async () => (await import("./cli/run.js")).run,
  daemon: async () => (await import("./cli/daemon.js")).daemonCommand,
  "native-host": async () => (await import("./cli/native-host.js")).nativeHostCommand,
  sessions: async () => (await import("./cli/bridge.js")).sessionsCommand,
  agent: async () => (await import("./cli/bridge.js")).agentCommand,
  shell: async () => (await import("./cli/bridge.js")).shellCommand,
  config: async () => (await import("./cli/bridge.js")).configCommand,
};

const USAGE = `northstar ${VERSION}

Usage: northstar [command]

Commands:
  serve       start the MCP server over stdio (default)
  init [dir]  write DESIGN.md, PRODUCT.md and design/decisions.md, never overwriting
  detect      scan UI files for generic AI patterns, exits 1 on errors
  capture     screenshot a URL in headless Chrome, needs Google Chrome
  audit       render a URL in headless Chrome and audit the real page, exits 1 on errors
  hook        agent hook entry point, never fails an edit
  conflicts   find overlapping design skills, --remove quarantines them
  install     set Northstar up in Claude Code, Codex, Cursor, Gemini CLI and OpenCode, and register the browser helper
  uninstall   remove what install added
  doctor      check the install, hooks, assets, browser helper and shell integration
  run <agent> start an agent in a Northstar session so Send to AI can reach it
  sessions    list the running agent sessions
  agent       list the agents Northstar knows, or add your own
  shell       install or uninstall shell functions so claude, codex and the rest start through run
  config      show or change the preferred agent, the template and the project mappings
  daemon      run the local daemon, or stop it or show its status
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
