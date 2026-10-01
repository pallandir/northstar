import { join } from "node:path";
import {
  type HookEntry,
  child,
  parseJsonObject,
  prune,
  removeBlock,
  removeHook,
  removeTomlTables,
  upsertBlock,
  upsertHook,
  upsertToml,
  writeJson,
} from "../merge.js";
import { opencodePlugin } from "./opencode-plugin.js";
import { type AgentPlan, type Op, PACKAGE, type PlanContext, SERVER } from "./types.js";

export function launchOf(ctx: Pick<PlanContext, "launch">): { command: string; args: string[] } {
  return ctx.launch ?? { command: "npx", args: ["-y", PACKAGE] };
}

export function hookCommand(
  version: string,
  agent: string,
  launch?: PlanContext["launch"],
): string {
  const base = `hook post-edit --agent ${agent}`;
  if (launch) {
    const parts = [launch.command, ...launch.args].map((part) => `"${part}"`).join(" ");
    return `sh -c '${parts} ${base} || true'`;
  }
  return `sh -c '(command -v northstar >/dev/null 2>&1 && northstar ${base}) || npx -y ${PACKAGE}@${version} ${base} || true'`;
}

function standardEntry(ctx: PlanContext) {
  const { command, args } = launchOf(ctx);
  return { command, args, env: { NORTHSTAR_PACKS: ctx.packs } };
}

function jsonMerge(
  path: string,
  label: string,
  edit: (root: Record<string, unknown>) => void,
  undo: (root: Record<string, unknown>) => void,
): Op {
  return {
    kind: "merge",
    path,
    label,
    apply(existing) {
      const root = parseJsonObject(existing, path);
      edit(root);
      return writeJson(root);
    },
    remove(existing) {
      const root = parseJsonObject(existing, path);
      undo(root);
      return Object.keys(root).length ? writeJson(root) : "";
    },
  };
}

function mcpServersMerge(path: string, ctx: PlanContext): Op {
  return jsonMerge(
    path,
    "MCP server",
    (root) => {
      child(root, "mcpServers")[SERVER] = standardEntry(ctx);
    },
    (root) => {
      const servers = root.mcpServers as Record<string, unknown> | undefined;
      if (servers) delete servers[SERVER];
      prune(root, "mcpServers");
    },
  );
}

function blockMerge(path: string, ctx: PlanContext): Op {
  return {
    kind: "merge",
    path,
    label: "context snippet",
    apply: (existing) => upsertBlock(existing, ctx.snippet),
    remove: (existing) => removeBlock(existing),
  };
}

const skillOp = (path: string): Op => ({
  kind: "skill",
  path: join(path, "northstar"),
  label: "skill",
});

function claude(ctx: PlanContext): AgentPlan {
  const root = ctx.scope === "user" ? join(ctx.home, ".claude") : join(ctx.project, ".claude");
  const entry: HookEntry = {
    matcher: "Edit|Write|MultiEdit",
    hooks: [
      { type: "command", command: hookCommand(ctx.version, "claude", ctx.launch), timeout: 20 },
    ],
  };
  const ops: Op[] = [];
  if (ctx.scope === "user") {
    const add: [string, ...string[]] = [
      "claude",
      "mcp",
      "add",
      "--env",
      `NORTHSTAR_PACKS=${ctx.packs}`,
      "--transport",
      "stdio",
      "--scope",
      "user",
      SERVER,
      "--",
      launchOf(ctx).command,
      ...launchOf(ctx).args,
    ];
    ops.push({
      kind: "command",
      label: "MCP server",
      reset: ["claude", "mcp", "remove", SERVER, "--scope", "user"],
      run: add,
      undo: ["claude", "mcp", "remove", SERVER, "--scope", "user"],
    });
  } else {
    ops.push(mcpServersMerge(join(ctx.project, ".mcp.json"), ctx));
  }
  ops.push(
    jsonMerge(
      join(root, "settings.json"),
      "post edit scan hook",
      (settings) => upsertHook(settings, "PostToolUse", entry),
      (settings) => removeHook(settings, "PostToolUse"),
    ),
    {
      kind: "file",
      path: join(root, "agents", "northstar-critic.md"),
      label: "critic agent",
      content: ctx.critic,
    },
    skillOp(join(root, "skills")),
  );
  if (ctx.scope === "project") ops.push(blockMerge(join(ctx.project, "CLAUDE.md"), ctx));
  return { agent: "claude", ops, notes: [] };
}

function codex(ctx: PlanContext): AgentPlan {
  const user = ctx.scope === "user";
  const root = user ? join(ctx.home, ".codex") : join(ctx.project, ".codex");
  const table = `mcp_servers.${SERVER}`;
  const body = [
    `[${table}]`,
    `command = ${JSON.stringify(launchOf(ctx).command)}`,
    `args = ${JSON.stringify(launchOf(ctx).args)}`,
    "startup_timeout_sec = 30",
    "",
    `[${table}.env]`,
    `NORTHSTAR_PACKS = "${ctx.packs}"`,
  ].join("\n");
  const entry: HookEntry = {
    matcher: "apply_patch|Edit|Write",
    hooks: [
      {
        type: "command",
        command: hookCommand(ctx.version, "codex", ctx.launch),
        timeout: 30,
        statusMessage: "Northstar scan",
      },
    ],
  };
  return {
    agent: "codex",
    ops: [
      {
        kind: "merge",
        path: join(root, "config.toml"),
        label: "MCP server",
        apply: (existing) => upsertToml(existing, table, body),
        remove: (existing) => removeTomlTables(existing, table),
      },
      jsonMerge(
        join(root, "hooks.json"),
        "post edit scan hook",
        (hooks) => upsertHook(hooks, "PostToolUse", entry),
        (hooks) => removeHook(hooks, "PostToolUse"),
      ),
      skillOp(user ? join(ctx.home, ".agents", "skills") : join(ctx.project, ".agents", "skills")),
      blockMerge(
        user ? join(ctx.home, ".codex", "AGENTS.md") : join(ctx.project, "AGENTS.md"),
        ctx,
      ),
    ],
    notes: ["Codex asks you to review and trust a new hook the first time it runs."],
  };
}

function cursor(ctx: PlanContext): AgentPlan {
  const user = ctx.scope === "user";
  const ops: Op[] = [
    mcpServersMerge(
      user ? join(ctx.home, ".cursor", "mcp.json") : join(ctx.project, ".cursor", "mcp.json"),
      ctx,
    ),
    skillOp(user ? join(ctx.home, ".agents", "skills") : join(ctx.project, ".agents", "skills")),
  ];
  if (!user) {
    ops.push({
      kind: "file",
      path: join(ctx.project, ".cursor", "rules", "northstar.mdc"),
      label: "always on rule",
      content: `---\ndescription: Northstar UI design rules and tools\nalwaysApply: true\n---\n\n${ctx.snippet.trim()}\n`,
    });
  }
  return {
    agent: "cursor",
    ops,
    notes: [
      "Cursor has no edit hook that can return feedback to the model, so there is no automatic scan. The agent runs slop_scan itself, guided by the rule file.",
      ...(user
        ? [
            "Run northstar install --scope project inside a project to add the always on Cursor rule.",
          ]
        : []),
    ],
  };
}

function gemini(ctx: PlanContext): AgentPlan {
  const user = ctx.scope === "user";
  const root = user ? join(ctx.home, ".gemini") : join(ctx.project, ".gemini");
  const entry: HookEntry = {
    matcher: "write_file|replace",
    hooks: [
      {
        type: "command",
        name: "northstar-scan",
        command: hookCommand(ctx.version, "gemini", ctx.launch),
        timeout: 20000,
      },
    ],
  };
  return {
    agent: "gemini",
    ops: [
      jsonMerge(
        join(root, "settings.json"),
        "MCP server and scan hook",
        (settings) => {
          child(settings, "mcpServers")[SERVER] = standardEntry(ctx);
          upsertHook(settings, "AfterTool", entry);
        },
        (settings) => {
          const servers = settings.mcpServers as Record<string, unknown> | undefined;
          if (servers) delete servers[SERVER];
          prune(settings, "mcpServers");
          removeHook(settings, "AfterTool");
        },
      ),
      skillOp(user ? join(ctx.home, ".agents", "skills") : join(ctx.project, ".agents", "skills")),
      blockMerge(user ? join(root, "GEMINI.md") : join(ctx.project, "GEMINI.md"), ctx),
    ],
    notes: ["Gemini asks for confirmation the first time a skill is activated."],
  };
}

function opencode(ctx: PlanContext): AgentPlan {
  const user = ctx.scope === "user";
  const root = user ? join(ctx.home, ".config", "opencode") : ctx.project;
  const configRoot = user ? root : join(ctx.project, ".opencode");
  return {
    agent: "opencode",
    ops: [
      jsonMerge(
        join(root, "opencode.json"),
        "MCP server",
        (config) => {
          config.$schema ??= "https://opencode.ai/config.json";
          child(config, "mcp")[SERVER] = {
            type: "local",
            command: [launchOf(ctx).command, ...launchOf(ctx).args],
            enabled: true,
            environment: { NORTHSTAR_PACKS: ctx.packs },
            timeout: 30000,
          };
        },
        (config) => {
          const servers = config.mcp as Record<string, unknown> | undefined;
          if (servers) delete servers[SERVER];
          prune(config, "mcp");
          if (Object.keys(config).length === 1 && config.$schema)
            Reflect.deleteProperty(config, "$schema");
        },
      ),
      {
        kind: "file",
        path: join(configRoot, "plugins", "northstar.ts"),
        label: "post edit scan plugin",
        content: opencodePlugin(hookCommand(ctx.version, "opencode", ctx.launch)),
      },
      skillOp(join(configRoot, "skills")),
      blockMerge(user ? join(root, "AGENTS.md") : join(ctx.project, "AGENTS.md"), ctx),
    ],
    notes: [
      "The OpenCode global config path is documented as ~/.config/opencode, confirm it with northstar doctor.",
    ],
  };
}

export function planAgent(ctx: PlanContext): AgentPlan {
  switch (ctx.agent) {
    case "claude":
      return claude(ctx);
    case "codex":
      return codex(ctx);
    case "cursor":
      return cursor(ctx);
    case "gemini":
      return gemini(ctx);
    case "opencode":
      return opencode(ctx);
  }
}
