import { constants, accessSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { AgentInfo } from "@northstar/protocol";

export interface AgentDefinition {
  id: string;
  name: string;
  executable: string;
  quickRunArgs: string[] | null;
}

const PROMPT = "{{prompt}}";

export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  { id: "claude", name: "Claude Code", executable: "claude", quickRunArgs: ["-p", PROMPT] },
  { id: "codex", name: "Codex", executable: "codex", quickRunArgs: ["exec", PROMPT] },
  { id: "gemini", name: "Gemini CLI", executable: "gemini", quickRunArgs: ["-p", PROMPT] },
  { id: "opencode", name: "OpenCode", executable: "opencode", quickRunArgs: ["run", PROMPT] },
  { id: "aider", name: "Aider", executable: "aider", quickRunArgs: ["--message", PROMPT] },
  { id: "goose", name: "Goose", executable: "goose", quickRunArgs: ["run", "-t", PROMPT] },
];

const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function assertAgentId(id: string): void {
  if (!AGENT_ID.test(id)) {
    throw new Error(
      `"${id}" is not a valid agent id. Use letters, digits, dots, dashes and underscores, up to 64 characters.`,
    );
  }
}

export function findExecutable(
  executable: string,
  pathEnv: string = process.env.PATH ?? "",
): string | null {
  const candidates = isAbsolute(executable)
    ? [executable]
    : pathEnv
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, executable));
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES" && code !== "ENOTDIR") throw error;
    }
  }
  return null;
}

export function mergeAgents(custom: readonly AgentDefinition[]): AgentDefinition[] {
  const byId = new Map<string, AgentDefinition>();
  for (const agent of BUILTIN_AGENTS) byId.set(agent.id, agent);
  for (const agent of custom) byId.set(agent.id, agent);
  return [...byId.values()];
}

export function describeAgents(agents: readonly AgentDefinition[], pathEnv?: string): AgentInfo[] {
  return agents.map((agent) => {
    const path = findExecutable(agent.executable, pathEnv);
    return {
      id: agent.id,
      name: agent.name,
      installed: path !== null,
      path,
      quickRun: agent.quickRunArgs !== null,
    };
  });
}

export function quickRunArgv(agent: AgentDefinition, line: string): string[] {
  if (!agent.quickRunArgs) {
    throw new Error(`${agent.name} has no quick run command.`);
  }
  return agent.quickRunArgs.map((arg) => (arg === PROMPT ? line : arg));
}
