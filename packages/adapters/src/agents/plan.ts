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
import { CORE_SKILL, SKILL_NAMES } from "../skills.js";
import { opencodePlugin } from "./opencode-plugin.js";
import { type AgentPlan, type Op, PACKAGE, type PlanContext, SERVER } from "./types.js";

export function launchOf(ctx: Pick<PlanContext, "launch" | "version">): {
  command: string;
  args: string[];
} {
  return ctx.launch ?? { command: "npx", args: ["-y", `${PACKAGE}@${ctx.version}`] };
}

export function serverEnv(ctx: Pick<PlanContext, "packs">): Record<string, string> {
  return { NORTHSTAR_PACKS: ctx.packs };
}

const LAUNCHER = [
  "const cp=require('child_process');",
  "const a=process.argv.slice(1);",
  "const npx=a[0]==='npx';",
  "if(npx===false&&require('fs').existsSync(a[0])===false){console.error('Northstar is not installed at '+a[0]+'. Run northstar install again.');process.exit(1)}",
  "const r=npx?cp.spawnSync('npx',a.slice(1),{stdio:'inherit',shell:process.platform==='win32'}):cp.spawnSync(process.execPath,a,{stdio:'inherit'});",
  "if(r.error||r.status===null){console.error('Northstar hook failed: '+(r.error?r.error.message:'killed by signal')+'. Run northstar doctor.');process.exit(1)}",
  "process.exit(r.status)",
].join("");

export function hookArgv(
  ctx: Pick<PlanContext, "launch" | "version">,
  agent: string,
  event: "pre-edit" | "post-edit" = "post-edit",
): string[] {
  const { command, args } = launchOf(ctx);
  const target = command === "node" ? args : [command, ...args];
  return ["node", "-e", LAUNCHER, ...target, "hook", event, "--agent", agent];
}

const SAFE_ARG = /^[\w@./:=+-]+$/;

export function hookCommand(
  ctx: Pick<PlanContext, "launch" | "version">,
  agent: string,
  event: "pre-edit" | "post-edit" = "post-edit",
): string {
  return hookArgv(ctx, agent, event)
    .map((part) => (SAFE_ARG.test(part) ? part : `"${part}"`))
    .join(" ");
}

function standardEntry(ctx: PlanContext) {
  const { command, args } = launchOf(ctx);
  return { command, args, env: serverEnv(ctx) };
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
      return Object.keys(root).length ? writeJson(root) : "";
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

const skillOps = (path: string): Op[] =>
  SKILL_NAMES.map((name) => ({
    kind: "skill" as const,
    name,
    path: join(path, name),
    label: name === CORE_SKILL ? "skill" : `skill ${name}`,
  }));

function claude(ctx: PlanContext): AgentPlan {
  const root = ctx.scope === "user" ? join(ctx.home, ".claude") : join(ctx.project, ".claude");
  const entry: HookEntry = {
    matcher: "Edit|Write|MultiEdit|NotebookEdit",
    hooks: [{ type: "command", command: hookCommand(ctx, "claude"), timeout: 20 }],
  };
  const gate: HookEntry = {
    matcher: "Edit|Write|MultiEdit|NotebookEdit",
    hooks: [
      {
        type: "command",
        command: hookCommand(ctx, "claude", "pre-edit"),
        timeout: 10,
      },
    ],
  };
  const ops: Op[] = [];
  if (ctx.scope === "user") {
    const add: [string, ...string[]] = [
      "claude",
      "mcp",
      "add",
      ...Object.entries(serverEnv(ctx)).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
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
  const settings = join(root, "settings.json");
  if (ctx.plugin) {
    ops.push(
      jsonMerge(
        settings,
        "remove hooks the Northstar plugin already provides",
        (config) => {
          removeHook(config, "PreToolUse");
          removeHook(config, "PostToolUse");
        },
        () => undefined,
      ),
    );
    return {
      agent: "claude",
      ops,
      notes: [
        "The Northstar Claude plugin is installed, so its hooks, skill and critic agent are used and not registered twice.",
      ],
    };
  }
  ops.push(
    jsonMerge(
      settings,
      "design gate and post edit scan hooks",
      (config) => {
        if (ctx.gate === false) removeHook(config, "PreToolUse");
        else upsertHook(config, "PreToolUse", gate);
        upsertHook(config, "PostToolUse", entry);
      },
      (config) => {
        removeHook(config, "PreToolUse");
        removeHook(config, "PostToolUse");
      },
    ),
    {
      kind: "file",
      path: join(root, "agents", "northstar-critic.md"),
      label: "critic agent",
      content: ctx.critic,
    },
    ...skillOps(join(root, "skills")),
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
    ...Object.entries(serverEnv(ctx)).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
  ].join("\n");
  const entry: HookEntry = {
    matcher: "apply_patch|Edit|Write",
    hooks: [
      {
        type: "command",
        command: hookCommand(ctx, "codex"),
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
      ...skillOps(
        user ? join(ctx.home, ".agents", "skills") : join(ctx.project, ".agents", "skills"),
      ),
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
    ...skillOps(
      user ? join(ctx.home, ".agents", "skills") : join(ctx.project, ".agents", "skills"),
    ),
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
        command: hookCommand(ctx, "gemini"),
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
      ...skillOps(
        user ? join(ctx.home, ".agents", "skills") : join(ctx.project, ".agents", "skills"),
      ),
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
            environment: serverEnv(ctx),
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
        content: opencodePlugin(hookArgv(ctx, "opencode")),
      },
      ...skillOps(join(configRoot, "skills")),
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
