import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const UNPACKED_LOCATION = 4;
const EXTENSION_NAME = "Northstar";

export function chromeUserDataDir(home: string, platform: NodeJS.Platform): string | null {
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Google", "Chrome");
  if (platform === "linux") return join(home, ".config", "google-chrome");
  return null;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${path}: ${(error as Error).message}`);
  }
}

function manifestName(directory: string): string | null {
  const manifest = readJson(join(directory, "manifest.json")) as { name?: unknown } | null;
  return typeof manifest?.name === "string" ? manifest.name : null;
}

interface PreferenceEntry {
  location?: number;
  path?: string;
}

export function findLocalExtensionIds(
  home: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const root = chromeUserDataDir(home, platform);
  if (!root || !existsSync(root)) return [];
  const ids = new Set<string>();
  for (const profile of readdirSync(root, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    for (const file of ["Secure Preferences", "Preferences"]) {
      const preferences = readJson(join(root, profile.name, file)) as {
        extensions?: { settings?: Record<string, PreferenceEntry> };
      } | null;
      for (const [id, entry] of Object.entries(preferences?.extensions?.settings ?? {})) {
        if (entry.location !== UNPACKED_LOCATION || typeof entry.path !== "string") continue;
        if (!/^[a-p]{32}$/.test(id)) continue;
        if (manifestName(entry.path) === EXTENSION_NAME) ids.add(id);
      }
    }
  }
  return [...ids].sort();
}
