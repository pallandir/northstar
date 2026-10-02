import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Canon } from "@northstar/canon";
import { getCanon, getData } from "./assets.js";
import { VERSION } from "./config.js";
import type { BridgeStatus, BrokerLink } from "./daemon/link.js";
import type { DesignData } from "./data/index.js";
import { RESOLVE_DIRECTIVE } from "./directive.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import type { CommentStore } from "./store.js";
import { registerComments } from "./tools/comments.js";
import { registerCore } from "./tools/core.js";
import { registerCritique } from "./tools/critique.js";
import { registerDesign } from "./tools/design.js";
import { registerDetect } from "./tools/detect.js";
import { registerPage } from "./tools/page.js";
import { registerResearch } from "./tools/research.js";
import { registerResolve } from "./tools/resolve.js";
import { registerSystem } from "./tools/system.js";

const INSTRUCTIONS = `\
Northstar is a UI design advisory framework with a browser comment handoff. For any UI design, redesign, \
polish, adapt or review work, use the northstar skill and call northstar_context first when it is listed. Write \
DESIGN.md before any UI code and keep the gate in northstar_context open. Work \
library first and avoid generic AI defaults. Without the skill, read the references at northstar://canon. \
Browser comments arrive only when the developer clicks "Send to AI", through the resolve-comments prompt: there \
is nothing to poll or watch.`;

export class RemovedSettingError extends Error {}

export function createMcpServer(
  store: CommentStore,
  broker: BrokerLink,
  canon: Canon = getCanon(),
  options: {
    root?: string;
    data?: DesignData;
    bridge?: () => BridgeStatus;
  } = {},
): McpServer {
  if (process.env.NORTHSTAR_PACKS !== undefined) {
    throw new RemovedSettingError(
      "NORTHSTAR_PACKS was removed, every tool is always available now. Delete NORTHSTAR_PACKS from the northstar MCP server entry, or run northstar install to rewrite it.",
    );
  }
  const server = new McpServer(
    { name: "northstar", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerPrompt(
    "resolve-comments",
    {
      title: "Resolve Northstar comments",
      description: "Implement every open UI comment left through the Northstar extension.",
    },
    () => ({
      messages: [
        { role: "user" as const, content: { type: "text" as const, text: RESOLVE_DIRECTIVE } },
      ],
    }),
  );

  registerPrompts(server);
  registerResources(server, canon);

  const root = options.root ?? process.env.NORTHSTAR_ROOT ?? process.cwd();
  const data = () => options.data ?? getData();
  registerCore(
    server,
    root,
    options.bridge ?? (() => ({ state: "off", error: "This server instance has no daemon link." })),
    canon,
  );
  registerComments(server, store, broker, root, canon);
  registerResearch(server, data);
  registerResolve(server, canon, data, root);
  registerDetect(server, root);
  registerSystem(server, canon, data, root);
  registerCritique(server, canon, root);
  registerPage(server, canon, root);
  registerDesign(server, root);

  return server;
}
