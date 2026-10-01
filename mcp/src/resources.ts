import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Canon,
  buildCatalog,
  renderArbitration,
  renderIndex,
  renderRule,
} from "@northstar/canon";

const MARKDOWN = "text/markdown";

function markdown(uri: URL, text: string) {
  return { contents: [{ uri: uri.href, mimeType: MARKDOWN, text }] };
}

export function registerResources(server: McpServer, canon: Canon): void {
  server.registerResource(
    "framework",
    "northstar://canon/framework",
    {
      title: "The Northstar method",
      description: "Stages, modes, artifacts and policies.",
      mimeType: MARKDOWN,
    },
    (uri) => markdown(uri, canon.framework),
  );

  server.registerResource(
    "index",
    "northstar://canon/index",
    {
      title: "Canon index",
      description:
        "A small map of every reference section, rule family and archetype. Read it before searching.",
      mimeType: MARKDOWN,
    },
    (uri) => markdown(uri, renderIndex(canon, buildCatalog(canon))),
  );

  server.registerResource(
    "arbitration",
    "northstar://canon/arbitration",
    {
      title: "Arbitration",
      description: "Precedence and the resolved conflicts between design guidance.",
      mimeType: MARKDOWN,
    },
    (uri) => markdown(uri, renderArbitration(canon)),
  );

  server.registerResource(
    "reference",
    new ResourceTemplate("northstar://canon/references/{topic}", {
      list: async () => ({
        resources: canon.references.map((reference) => ({
          uri: `northstar://canon/references/${reference.topic}`,
          name: `reference-${reference.topic}`,
          title: reference.title,
          description: reference.loadWhen,
          mimeType: MARKDOWN,
        })),
      }),
    }),
    {
      title: "Design reference",
      description: "One reference per stage or lens.",
      mimeType: MARKDOWN,
    },
    (uri, { topic }) => {
      const reference = canon.references.find((r) => r.topic === topic);
      if (!reference) throw new Error(`unknown reference ${String(topic)}`);
      return markdown(uri, reference.body);
    },
  );

  server.registerResource(
    "rule",
    new ResourceTemplate("northstar://canon/rules/{id}", {
      list: async () => ({
        resources: canon.rules.map((rule) => ({
          uri: `northstar://canon/rules/${rule.id}`,
          name: rule.id,
          title: rule.title,
          mimeType: MARKDOWN,
        })),
      }),
    }),
    {
      title: "Design rule",
      description: "One rule with its rationale and fix.",
      mimeType: MARKDOWN,
    },
    (uri, { id }) => {
      const rule = canon.rules.find((r) => r.id === id);
      if (!rule) throw new Error(`unknown rule ${String(id)}`);
      return markdown(uri, renderRule(rule));
    },
  );
}
