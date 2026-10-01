import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type Conflict,
  findConflicts,
  installedFor,
  quarantineDir,
  remove,
  restore,
} from "../install/conflicts.js";

interface Options {
  remove: boolean;
  yes: boolean;
  restore?: string;
  home: string;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

function parse(args: string[]): Options {
  const options: Options = { remove: false, yes: false, home: homedir() };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--remove") options.remove = true;
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--restore") options.restore = required(args[++i], arg);
    else if (arg === "--home") options.home = resolve(required(args[++i], arg));
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

const describe = (c: Conflict) =>
  `${c.kind} ${c.name} (${c.owner}${c.broken ? ", broken link" : ""})${c.path ? ` at ${c.path}` : ""}`;

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export async function conflicts(args: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (err) {
    process.stderr.write(
      `${(err as Error).message}\nUsage: northstar conflicts [--remove] [--yes] [--restore <stamp>]\n`,
    );
    return 2;
  }

  if (options.restore) {
    try {
      const { restored, failed } = restore(options.home, options.restore);
      for (const path of restored) process.stdout.write(`restored ${path}\n`);
      for (const line of failed) process.stderr.write(`not restored ${line}\n`);
      return failed.length ? 1 : 0;
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      return 1;
    }
  }

  let found: Conflict[];
  try {
    found = findConflicts(options.home);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
  if (!found.length) {
    process.stdout.write("No conflicting design skills found.\n");
    return 0;
  }
  for (const conflict of found) process.stdout.write(`${describe(conflict)}\n`);
  if (!options.remove) {
    process.stdout.write(
      "\nRun northstar conflicts --remove to move them to a quarantine you can restore.\n",
    );
    return 0;
  }

  let eligible: Conflict[];
  try {
    eligible = found.filter((c) => installedFor(options.home, c));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
  for (const conflict of found.filter((c) => !eligible.includes(c))) {
    process.stderr.write(
      `kept ${conflict.name}: Northstar is not installed for ${conflict.owner} yet, run northstar install first\n`,
    );
  }
  if (!eligible.length) return 1;
  if (!options.yes && !process.stdin.isTTY) {
    process.stderr.write("Removal needs a terminal to confirm each item, or pass --yes.\n");
    return 2;
  }

  const chosen: Conflict[] = [];
  for (const conflict of eligible) {
    if (options.yes || (await confirm(`Remove ${describe(conflict)}?`))) chosen.push(conflict);
  }
  if (!chosen.length) return 0;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const run = (command: string, commandArgs: string[]) => {
    execFileSync(command, commandArgs, { stdio: "inherit" });
  };
  const result = remove(options.home, chosen, stamp, run);
  for (const entry of result.moved) process.stdout.write(`moved ${entry.name} to ${entry.to}\n`);
  for (const id of result.uninstalled) process.stdout.write(`uninstalled plugin ${id}\n`);
  for (const line of result.failed) process.stderr.write(`failed ${line}\n`);
  if (result.moved.length) {
    process.stdout.write(
      `\nRestore with: northstar conflicts --restore ${stamp}\nQuarantine: ${quarantineDir(options.home, stamp)}\n`,
    );
  }
  return result.failed.length ? 1 : 0;
}
