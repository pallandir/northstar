import { MODES, type Mode } from "@northstar/canon";
import { parse } from "yaml";
import type { AllowEntry, ScanConfig } from "./types.js";

export const DEFAULT_MODE: Mode = "persuade";

export function defaultConfig(): ScanConfig {
  return { mode: DEFAULT_MODE, designSystem: false, allow: [], ignore: [] };
}

export function configFromDesign(source: string | undefined): ScanConfig {
  const config = defaultConfig();
  if (!source) return config;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return config;
  try {
    const data = parse(match[1] ?? "") as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return config;
    config.designSystem = typeof data.name === "string" && typeof data.colors === "object";
    const northstar = (data.northstar ?? {}) as Record<string, unknown>;
    if (
      typeof northstar.mode === "string" &&
      (MODES as readonly string[]).includes(northstar.mode)
    ) {
      config.mode = northstar.mode as Mode;
    }
    if (Array.isArray(northstar.allow)) {
      config.allow = northstar.allow.filter(
        (entry): entry is AllowEntry => !!entry && typeof (entry as AllowEntry).rule === "string",
      );
    }
    if (Array.isArray(northstar.ignore)) {
      config.ignore = northstar.ignore.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  } catch {
    return config;
  }
  return config;
}
