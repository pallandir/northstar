import { MODES, type Mode } from "@northstar/canon";
import { parseFrontmatter } from "@northstar/design-md";
import type { AllowEntry, ScanConfig } from "./types.js";

export const DEFAULT_MODE: Mode = "persuade";

export function defaultConfig(): ScanConfig {
  return { mode: DEFAULT_MODE, designSystem: false, allow: [], ignore: [] };
}

export function configFromDesign(source: string | undefined): ScanConfig {
  const config = defaultConfig();
  if (source === undefined) return config;
  const { frontmatter: data } = parseFrontmatter(source);
  config.designSystem = typeof data.name === "string" && typeof data.colors === "object";
  const northstar = (data.northstar ?? {}) as Record<string, unknown>;
  if (northstar.mode !== undefined) {
    if (
      typeof northstar.mode !== "string" ||
      !(MODES as readonly string[]).includes(northstar.mode)
    ) {
      throw new Error(
        `DESIGN.md northstar.mode is ${JSON.stringify(northstar.mode)}, set it to one of ${MODES.join(", ")}`,
      );
    }
    config.mode = northstar.mode as Mode;
  }
  if (northstar.allow !== undefined) {
    if (!Array.isArray(northstar.allow)) {
      throw new Error("DESIGN.md northstar.allow must be a list of { rule, reason } entries");
    }
    config.allow = northstar.allow.map((entry, index) => {
      if (!entry || typeof (entry as AllowEntry).rule !== "string") {
        throw new Error(`DESIGN.md northstar.allow[${index}] needs a rule id, fix or remove it`);
      }
      return entry as AllowEntry;
    });
  }
  if (northstar.ignore !== undefined) {
    if (!Array.isArray(northstar.ignore) || northstar.ignore.some((e) => typeof e !== "string")) {
      throw new Error("DESIGN.md northstar.ignore must be a list of glob strings");
    }
    config.ignore = northstar.ignore as string[];
  }
  return config;
}
