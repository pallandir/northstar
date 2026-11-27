import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MODES, type Mode } from "@northstar/canon";
import { getCanon } from "../assets.js";
import { projectRoot } from "../lib/paths.js";
import { closeBrowser } from "../page/browser.js";
import { describeRun } from "../page/format.js";
import { auditProject, captureProject } from "../page/service.js";
import { VIEWPORT_NAMES, type ViewportName } from "../page/viewports.js";

const USAGE =
  "Usage: northstar <capture|audit> <url> [--viewport mobile,desktop] [--mode operate|read|persuade|experience] [--restart]";

interface PageArgs {
  url: string;
  viewports?: ViewportName[];
  mode?: Mode;
  restart?: boolean;
}

function parse(args: string[]): PageArgs {
  const { positionals, values } = parseArgs({
    args,
    options: {
      viewport: { type: "string" },
      mode: { type: "string" },
      restart: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  const [url] = positionals;
  if (!url) throw new Error(`The page address is missing. ${USAGE}`);
  const out: PageArgs = { url };
  if (values.restart) out.restart = true;
  if (values.viewport !== undefined) {
    const names = values.viewport.split(",");
    const bad = names.find((n) => !(VIEWPORT_NAMES as string[]).includes(n));
    if (bad) throw new Error(`Unknown viewport ${bad}. Use ${VIEWPORT_NAMES.join(", ")}.`);
    out.viewports = names as ViewportName[];
  }
  if (values.mode !== undefined) {
    if (!(MODES as readonly string[]).includes(values.mode)) {
      throw new Error(`Unknown mode ${values.mode}. Use ${MODES.join(", ")}.`);
    }
    out.mode = values.mode as Mode;
  }
  return out;
}

export async function audit(args: string[]): Promise<number> {
  try {
    const request = parse(args);
    const { record, top, repairs, dir, loop } = await auditProject({
      root: projectRoot(),
      canon: getCanon(),
      ...request,
    });
    process.stdout.write(`${describeRun(record, top, repairs, dir, loop)}\n`);
    return record.findings.some((f) => f.severity === "error") ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  } finally {
    await closeBrowser();
  }
}

export async function capture(args: string[]): Promise<number> {
  try {
    const request = parse(args);
    const { crops, notes } = await captureProject(request);
    const out = join(projectRoot(), ".northstar", "design", "captures");
    mkdirSync(out, { recursive: true });
    const files = crops.map((crop) => {
      const file = join(
        out,
        `${Date.now()}-${crop.viewport}-${crop.region.replace(/\s+/g, "-")}.jpg`,
      );
      writeFileSync(file, crop.data);
      return file;
    });
    process.stdout.write(`${[...notes, ...files].join("\n")}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  } finally {
    await closeBrowser();
  }
}
