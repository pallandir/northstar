import { resolve } from "node:path";
import { MODES, type Mode } from "@northstar/canon";
import { formatJson, formatSarif, formatText } from "@northstar/detector";
import { VERSION } from "../config.js";
import { runScan } from "../detect.js";

interface Options {
  paths: string[];
  format: "text" | "json" | "sarif";
  mode?: Mode;
  root: string;
  diff: boolean;
}

function parse(args: string[]): Options {
  const options: Options = {
    paths: [],
    format: "text",
    root: process.env.NORTHSTAR_ROOT ?? process.cwd(),
    diff: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--diff") options.diff = true;
    else if (arg === "--format") {
      const value = args[++i];
      if (value !== "text" && value !== "json" && value !== "sarif")
        throw new Error(`unknown format ${value}`);
      options.format = value;
    } else if (arg === "--mode") {
      const value = args[++i] ?? "";
      if (!(MODES as readonly string[]).includes(value)) throw new Error(`unknown mode ${value}`);
      options.mode = value as Mode;
    } else if (arg === "--root") {
      const value = args[++i];
      if (!value) throw new Error("--root needs a directory");
      options.root = resolve(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      options.paths.push(arg);
    }
  }
  return options;
}

export async function detect(args: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (err) {
    process.stderr.write(
      `${(err as Error).message}\nUsage: northstar detect [paths] [--diff] [--format text|json|sarif] [--mode operate|read|persuade|experience] [--root dir]\n`,
    );
    return 2;
  }

  let outcome: ReturnType<typeof runScan>;
  try {
    outcome = runScan(options);
  } catch (err) {
    process.stderr.write(`northstar detect: ${(err as Error).message}\n`);
    return 2;
  }
  const { findings, scanned } = outcome;
  if (options.format === "json") process.stdout.write(`${formatJson(findings)}\n`);
  else if (options.format === "sarif") process.stdout.write(`${formatSarif(findings, VERSION)}\n`);
  else if (findings.length) process.stdout.write(`${formatText(findings)}\n`);

  const errors = findings.filter((f) => f.severity === "error").length;
  if (options.format === "text") {
    process.stderr.write(
      `scanned ${scanned} files: ${errors} errors, ${findings.length - errors} other findings\n`,
    );
  }
  return errors > 0 ? 1 : 0;
}
