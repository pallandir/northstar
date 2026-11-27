import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MODES, type Mode } from "@northstar/canon";
import { VERSION } from "../config.js";
import { runScan } from "../detect.js";
import { formatJson, formatSarif, formatText } from "../detector/index.js";
import { projectRoot } from "../lib/paths.js";

interface Options {
  paths: string[];
  format: "text" | "json" | "sarif";
  mode?: Mode;
  root: string;
  diff: boolean;
}

function parse(args: string[]): Options {
  const { positionals, values } = parseArgs({
    args,
    options: {
      diff: { type: "boolean" },
      format: { type: "string", default: "text" },
      mode: { type: "string" },
      root: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const { format } = values;
  if (format !== "text" && format !== "json" && format !== "sarif") {
    throw new Error(`unknown format ${format}`);
  }
  if (values.mode !== undefined && !(MODES as readonly string[]).includes(values.mode)) {
    throw new Error(`unknown mode ${values.mode}`);
  }
  return {
    paths: positionals,
    format,
    mode: values.mode as Mode | undefined,
    root: values.root ? resolve(values.root) : projectRoot(),
    diff: values.diff ?? false,
  };
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
