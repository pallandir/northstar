import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

export const PACK_NAMES = [
  "core",
  "comments",
  "research",
  "system",
  "resolve",
  "detect",
  "critique",
] as const;

export type PackName = (typeof PACK_NAMES)[number];

export const PACK_SUMMARIES: Record<PackName, string> = {
  core: "Project context and pack control, always on.",
  comments: "Resolve UI comments left through the browser extension.",
  research: "Search ported design data: styles, palettes, pairings, products and UX guidance.",
  system: "Create, normalise, validate and export DESIGN.md.",
  resolve: "Pick libraries, fonts and icons instead of hand rolling them.",
  detect: "Scan UI files for generic AI patterns and explain the rules.",
  critique: "Score a built result against the rubric and keep the decisions log.",
};

const ALWAYS_ON: ReadonlySet<PackName> = new Set(["core", "comments"]);

export function parsePacks(value: string | undefined): Set<PackName> {
  const requested = (value ?? "dynamic").split(",").map((part) => part.trim().toLowerCase());
  if (requested.includes("all")) return new Set(PACK_NAMES);
  const active = new Set<PackName>(ALWAYS_ON);
  for (const name of requested) {
    if (name === "dynamic") continue;
    if (!(PACK_NAMES as readonly string[]).includes(name)) {
      throw new Error(
        `unknown pack "${name}" in NORTHSTAR_PACKS, use all, dynamic or a list of ${PACK_NAMES.join(", ")}`,
      );
    }
    active.add(name as PackName);
  }
  return active;
}

interface ToolConfig<I extends ZodRawShape | undefined> {
  description: string;
  inputSchema?: I;
}

export class PackRegistry {
  private readonly tools = new Map<string, { pack: PackName; tool: RegisteredTool }>();

  constructor(
    private readonly server: McpServer,
    private readonly active: Set<PackName>,
  ) {}

  register<I extends ZodRawShape | undefined = undefined>(
    pack: PackName,
    name: string,
    config: ToolConfig<I>,
    callback: ToolCallback<I>,
  ): RegisteredTool {
    const tool = this.server.registerTool(name, config, callback);
    if (!this.active.has(pack)) tool.disable();
    this.tools.set(name, { pack, tool });
    return tool;
  }

  isActive(pack: PackName): boolean {
    return this.active.has(pack);
  }

  activePacks(): PackName[] {
    return PACK_NAMES.filter((name) => this.active.has(name));
  }

  toolsOf(pack: PackName): string[] {
    return [...this.tools].filter(([, entry]) => entry.pack === pack).map(([name]) => name);
  }

  enable(packs: PackName[]): string[] {
    const added: string[] = [];
    for (const pack of packs) {
      this.active.add(pack);
      for (const [name, entry] of this.tools) {
        if (entry.pack === pack && !entry.tool.enabled) {
          entry.tool.enable();
          added.push(name);
        }
      }
    }
    return added;
  }

  disable(packs: PackName[]): string[] {
    const removed: string[] = [];
    for (const pack of packs) {
      if (ALWAYS_ON.has(pack)) continue;
      this.active.delete(pack);
      for (const [name, entry] of this.tools) {
        if (entry.pack === pack && entry.tool.enabled) {
          entry.tool.disable();
          removed.push(name);
        }
      }
    }
    return removed;
  }

  describe(
    name: string,
  ): { name: string; pack: PackName; description: string; args: string[] } | null {
    const entry = this.tools.get(name);
    if (!entry) return null;
    const shape = (entry.tool.inputSchema as { shape?: Record<string, unknown> } | undefined)
      ?.shape;
    return {
      name,
      pack: entry.pack,
      description: entry.tool.description ?? "",
      args: shape ? Object.keys(shape) : [],
    };
  }

  async call(name: string, args: unknown, extra: unknown) {
    const entry = this.tools.get(name);
    if (!entry || entry.pack === "core") throw new Error(`unknown pack tool ${name}`);
    const schema = entry.tool.inputSchema as
      | {
          safeParse(value: unknown): {
            success: boolean;
            data?: unknown;
            error?: { message: string };
          };
        }
      | undefined;
    let parsed: unknown;
    if (schema) {
      const result = schema.safeParse(args ?? {});
      if (!result.success)
        throw new Error(`invalid arguments for ${name}: ${result.error?.message}`);
      parsed = result.data;
    }
    const handler = entry.tool.handler as (...params: unknown[]) => Promise<unknown>;
    return schema ? handler(parsed, extra) : handler(extra);
  }
}
