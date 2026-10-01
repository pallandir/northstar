export const AGENT_NAMES = ["claude", "codex", "cursor", "gemini", "opencode"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export type Scope = "user" | "project";
export type Packs = "all" | "dynamic";

export interface PlanContext {
  agent: AgentName;
  scope: Scope;
  home: string;
  project: string;
  version: string;
  packs: Packs;
  snippet: string;
  critic: string;
  launch?: { command: string; args: string[] };
  extensionIds?: string[];
}

export type Cmd = [string, ...string[]];

export type Op =
  | {
      kind: "merge";
      path: string;
      label: string;
      apply(existing: string | undefined): string;
      remove(existing: string): string;
    }
  | { kind: "file"; path: string; label: string; content: string }
  | { kind: "skill"; path: string; label: string }
  | { kind: "command"; label: string; reset?: Cmd; run: Cmd; undo: Cmd };

export interface AgentPlan {
  agent: AgentName;
  ops: Op[];
  notes: string[];
}

export const PACKAGE = "@pallandir/northstar";
export const SERVER = "northstar";
