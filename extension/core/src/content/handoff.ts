import type { ComponentInfo, QueuedRequest, RouteInfo } from "../types.js";

// Mirrors the block shape mcp/src/server.ts renders for the agent, so a comment reads with the
// same precision whether it goes through the MCP tool or through this file: route, component and
// source first, the element and its selector next, the operation, then the comment itself.
export function buildHandoffMarkdown(requests: QueuedRequest[]): string {
  const source = requests.length ? safeHost(requests[0].url) : "frontend";
  const lines = [
    "---",
    "title: Design handoff",
    `source: ${source}`,
    `generated: ${new Date().toISOString()}`,
    `count: ${requests.length}`,
    "---",
    "",
    "# Design handoff",
    "",
    "Each item below is a requested change with where to find it.",
    "",
  ];

  requests.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${kindLabel(r)}`, "");
    lines.push(`- Route: ${formatRoute(r.route, r.metadata.page)}`);

    const component = formatComponent(r.component);
    if (component) lines.push(`- Component: ${component}`);

    if (r.source) {
      lines.push(
        `- Source: \`${r.source.path}:${r.source.line}:${r.source.column}\` (${r.source.via})`,
      );
    }

    if (r.target) {
      const tag = r.target.id ? `<${r.target.tag} id="${r.target.id}">` : `<${r.target.tag}>`;
      lines.push(`- Element: \`${tag}\`  Selector: \`${r.target.selector}\``);
    } else {
      lines.push(`- Element: \`${r.operator}\``);
    }
    lines.push(`- Page: ${r.url}`, "");

    const op = r.operation;
    if (op.type === "style" && op.property && op.from !== null && op.to !== null) {
      lines.push(`- \`${op.property}\`: \`${op.from}\` → \`${op.to}\``);
    } else if (op.type === "text" && op.from !== null && op.to !== null) {
      lines.push(`- text: "${op.from}" → "${op.to}"`);
    }

    if (r.comment) lines.push("", `> ${r.comment.split("\n").join("\n> ")}`);

    // Only when the user actually asked for this item to carry a screenshot: attachScreenshot is
    // the stored consent, not merely whether a data URL happens to be present.
    if (r.attachScreenshot && r.screenshotDataUrl && isDataImageUrl(r.screenshotDataUrl)) {
      lines.push("", `![item ${i + 1}](${r.screenshotDataUrl})`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function formatRoute(route: RouteInfo | null, pageFallback: string): string {
  if (!route) return pageFallback;
  const bits = [route.router, route.routeFile].filter((v): v is string => Boolean(v));
  const suffix = bits.length ? ` (${bits.join(" · ")})` : "";
  const hedge = route.confidence === "inferred" ? " _(inferred, not confirmed)_" : "";
  return `${route.pattern}${suffix}${hedge}`;
}

function formatComponent(component: ComponentInfo | null): string | null {
  if (!component?.stack.length) return null;
  return component.stack.map((f) => f.name).join(" < ");
}

export function downloadHandoff(requests: QueuedRequest[]): void {
  const blob = new Blob([buildHandoffMarkdown(requests)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `design-handoff-${safeHost(location.href)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function kindLabel(r: QueuedRequest): string {
  if (r.operation.type === "style") return "Style change";
  if (r.operation.type === "text") return "Text change";
  return "Comment";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/[:.]/g, "-");
  } catch {
    return "frontend";
  }
}

function isDataImageUrl(s: string): boolean {
  if (!s.startsWith("data:image/")) return false;
  const semi = s.indexOf(";base64,", 11);
  return semi > 11 && /^[a-z]+$/.test(s.slice(11, semi));
}
