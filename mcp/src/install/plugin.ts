import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const installedPluginsSchema = z.object({ plugins: z.record(z.string(), z.unknown()).default({}) });

export function installedPluginIds(home: string): string[] {
  const path = join(home, ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(path)) return [];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${(err as Error).message}), fix or delete it`);
  }
  const parsed = installedPluginsSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${path} has an unexpected shape (${parsed.error.issues[0]?.message}), fix or delete it`,
    );
  }
  return Object.keys(parsed.data.plugins).sort();
}

export function northstarPluginInstalled(home: string): boolean {
  return installedPluginIds(home).some((id) => id.startsWith("northstar@"));
}
