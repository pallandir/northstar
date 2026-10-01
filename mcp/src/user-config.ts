import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type TemplateId, templateSchema } from "@northstar/protocol";
import YAML from "yaml";
import { z } from "zod";
import { type AgentDefinition, assertAgentId } from "./agents/definitions.js";
import { configPath, northstarHome } from "./lib/home.js";

const PROMPT = "{{prompt}}";

export class ConfigError extends Error {}

const agentEntry = z
  .object({
    name: z.string().min(1).max(100).optional(),
    executable: z.string().min(1).max(4096),
    quickRun: z
      .object({
        args: z
          .array(z.string().max(1000))
          .max(40)
          .refine((args) => args.includes(PROMPT), `must contain ${PROMPT}`),
      })
      .strict()
      .optional(),
  })
  .strict();

const fileSchema = z
  .object({
    version: z.literal(1).optional(),
    preferences: z
      .object({
        preferredAgent: z.string().min(1).max(64).nullable().optional(),
        template: templateSchema.optional(),
      })
      .strict()
      .optional(),
    agents: z.record(agentEntry).optional(),
    projects: z.record(z.object({ directory: z.string().min(1).max(4096) }).strict()).optional(),
  })
  .strict();

type ConfigFile = z.infer<typeof fileSchema>;

interface UserSettings {
  preferredAgent: string | null;
  template: TemplateId;
  agents: AgentDefinition[];
  projects: Record<string, string>;
}

function describe(error: z.ZodError, path: string): string {
  const issue = error.issues[0] as z.ZodIssue;
  const where = issue.path.join(".") || "the file";
  return `The Northstar config ${path} is invalid at ${where}: ${issue.message}. Fix it or delete the file.`;
}

function readFile(path: string): ConfigFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw) ?? {};
  } catch (error) {
    throw new ConfigError(
      `The Northstar config ${path} is not valid YAML: ${(error as Error).message}. Fix it or delete the file.`,
    );
  }
  const result = fileSchema.safeParse(parsed);
  if (!result.success) throw new ConfigError(describe(result.error, path));
  return result.data;
}

function expandHome(directory: string, home: string): string {
  return directory === "~" || directory.startsWith("~/")
    ? join(home, directory.slice(1))
    : directory;
}

export function loadSettings(home: string = northstarHome()): UserSettings {
  const file = readFile(configPath(home));
  const agents = Object.entries(file.agents ?? {}).map(([id, entry]) => {
    assertAgentId(id);
    return {
      id,
      name: entry.name ?? id,
      executable: entry.executable,
      quickRunArgs: entry.quickRun?.args ?? null,
    };
  });
  const projects: Record<string, string> = {};
  for (const [key, entry] of Object.entries(file.projects ?? {})) {
    projects[key] = expandHome(entry.directory, home);
  }
  return {
    preferredAgent: file.preferences?.preferredAgent ?? null,
    template: file.preferences?.template ?? "resolve",
    agents,
    projects,
  };
}

function write(home: string, file: ConfigFile): void {
  const path = configPath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, YAML.stringify({ version: 1, ...file }), { mode: 0o600 });
  renameSync(staging, path);
}

export function updateSettings(
  home: string,
  change: {
    preferredAgent?: string | null;
    template?: TemplateId;
    projects?: Record<string, string>;
    agent?: { id: string; definition: z.infer<typeof agentEntry> };
  },
): UserSettings {
  const file = readFile(configPath(home));
  const preferences = { ...file.preferences };
  if (change.preferredAgent !== undefined) preferences.preferredAgent = change.preferredAgent;
  if (change.template !== undefined) preferences.template = change.template;
  const next: ConfigFile = { ...file, preferences };
  if (change.projects !== undefined) {
    next.projects = Object.fromEntries(
      Object.entries(change.projects).map(([key, directory]) => [key, { directory }]),
    );
  }
  if (change.agent) {
    assertAgentId(change.agent.id);
    next.agents = { ...file.agents, [change.agent.id]: change.agent.definition };
  }
  const checked = fileSchema.safeParse(next);
  if (!checked.success) throw new ConfigError(describe(checked.error, configPath(home)));
  write(home, checked.data);
  return loadSettings(home);
}
