export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeSourcePath(path: string): string | null {
  if (!path || path.length > 1000) return null;
  if (/[\p{Cc}]/u.test(path)) return null;
  if (path.startsWith("~")) return null;
  if (/^[a-zA-Z]:/.test(path) || path.startsWith("\\\\")) return null;
  if (path.split(/[/\\]/).some((s) => s === "..")) return null;
  return path;
}
