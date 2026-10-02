import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODES, type Mode } from "@northstar/canon";
import { getCanon } from "../assets.js";
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
  const url = args[0];
  if (!url || url.startsWith("--")) throw new Error(`The page address is missing. ${USAGE}`);
  const out: PageArgs = { url };
  for (let i = 1; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--restart") {
      out.restart = true;
      continue;
    }
    i += 1;
    const value = args[i];
    if (value === undefined) throw new Error(`${flag} needs a value. ${USAGE}`);
    if (flag === "--viewport") {
      const names = value.split(",");
      const bad = names.find((n) => !(VIEWPORT_NAMES as string[]).includes(n));
      if (bad) throw new Error(`Unknown viewport ${bad}. Use ${VIEWPORT_NAMES.join(", ")}.`);
      out.viewports = names as ViewportName[];
    } else if (flag === "--mode") {
      if (!(MODES as readonly string[]).includes(value)) {
        throw new Error(`Unknown mode ${value}. Use ${MODES.join(", ")}.`);
      }
      out.mode = value as Mode;
    } else {
      throw new Error(`Unknown option ${flag}. ${USAGE}`);
    }
  }
  return out;
}

export async function audit(args: string[]): Promise<number> {
  try {
    const request = parse(args);
    const { record, top, repairs, dir, loop } = await auditProject({
      root: process.cwd(),
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
    const out = join(process.cwd(), ".northstar", "design", "captures");
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
