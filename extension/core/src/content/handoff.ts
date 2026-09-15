import DOMPurify from "dompurify";
import { marked } from "marked";
import { escapeHtml } from "../lib/sanitize.js";
import type { QueuedRequest } from "../types.js";

function buildHandoffMarkdown(requests: QueuedRequest[]): string {
  const source = requests.length ? safeHost(requests[0].url) : "frontend";
  const lines = [
    "---",
    "title: Design handoff",
    `source: ${escapeHtml(source)}`,
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
    lines.push(`## ${i + 1}. ${kindLabel(r)} · ${escapeHtml(r.metadata.page)}`, "");
    if (r.comment) lines.push(`<blockquote>${escapeHtml(r.comment)}</blockquote>`, "");
    const op = r.operation;
    if (op.type === "style" && op.property && op.from !== null && op.to !== null) {
      lines.push(
        `- <code>${escapeHtml(op.property)}</code>: <code>${escapeHtml(String(op.from))}</code> → <code>${escapeHtml(String(op.to))}</code>`,
      );
    }
    if (op.type === "text" && op.from !== null && op.to !== null) {
      lines.push(
        `- text: <q>${escapeHtml(String(op.from))}</q> → <q>${escapeHtml(String(op.to))}</q>`,
      );
    }
    if (r.source) {
      lines.push(
        `- Source: <code>${escapeHtml(r.source.path)}:${r.source.line}:${r.source.column}</code>`,
      );
    }
    lines.push(`- Element: <code>${escapeHtml(r.operator)}</code>`);
    lines.push(`- Page: ${escapeHtml(r.url)}`, "");
    if (r.screenshotDataUrl && isDataImageUrl(r.screenshotDataUrl))
      lines.push(`<img alt="item ${i + 1}" src="${r.screenshotDataUrl}">`, "");
  });

  return lines.join("\n");
}

function buildHandoffHtml(requests: QueuedRequest[]): string {
  const md = buildHandoffMarkdown(requests);
  const rawHtml = marked.parse(md) as string;
  const body = DOMPurify.sanitize(rawHtml, { FORCE_BODY: true });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Design handoff</title>
<style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
blockquote{border-left:3px solid #d97757;margin:0;padding:.25rem .75rem;color:#444}
code{background:#f4f4f4;padding:.1em .3em;border-radius:3px;font-size:.9em}
img{max-width:100%;border:1px solid #ddd;border-radius:4px;margin:.5rem 0}
</style>
</head>
<body>${body}</body>
</html>`;
}

export function downloadHandoff(requests: QueuedRequest[]): void {
  const blob = new Blob([buildHandoffHtml(requests)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `design-handoff-${safeHost(location.href)}.html`;
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
