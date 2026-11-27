import { resolve } from "node:path";
import { TEMPLATE_IDS, templateSchema } from "@northstar/protocol";
import { northstarHome } from "../lib/home.js";
import { loadSettings, updateSettings } from "../user-config.js";

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

export async function configCommand(args: string[]): Promise<number> {
  const home = northstarHome();
  const [sub, key, value] = args;
  try {
    if (sub === undefined) {
      const s = loadSettings(home);
      process.stdout.write(`template: ${s.template}\n`);
      for (const [pattern, directory] of Object.entries(s.projects)) {
        process.stdout.write(`project ${pattern} -> ${directory}\n`);
      }
      return 0;
    }
    if (sub === "set" && key === "template" && value) {
      updateSettings(home, { template: templateSchema.parse(value) });
      return 0;
    }
    if (sub === "map" && key && value) {
      const projects = { ...loadSettings(home).projects, [key]: resolve(value) };
      updateSettings(home, { projects });
      return 0;
    }
    if (sub === "unmap" && key) {
      const projects = { ...loadSettings(home).projects };
      delete projects[key];
      updateSettings(home, { projects });
      return 0;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return fail(`The template must be one of ${TEMPLATE_IDS.join(", ")}.`);
    }
    return fail((error as Error).message);
  }
  return fail(
    "Usage: northstar config [set template <id> | map <host[:port][/path]> <dir> | unmap <key>]",
  );
}
