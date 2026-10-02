const CONTROL_OR_NUL = /[\p{Cc}]/u;
const URL_PREFIX = /^(?:file:\/\/|webpack(?:-internal)?:\/\/[^/]*\/|vite:\/\/|\/@fs\/)/;
const DRIVE = /^[a-zA-Z]:[\\/]/;

export class SourcePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcePathError";
  }
}

function segments(path: string): string[] {
  return path.split(/[/\\]/);
}

export function assertSafeSourcePath(path: string): void {
  if (path.length === 0) throw new SourcePathError("the source path is empty");
  if (CONTROL_OR_NUL.test(path)) {
    throw new SourcePathError("the source path contains control characters");
  }
  const parts = segments(path);
  if (parts.includes("..")) throw new SourcePathError("the source path must not contain ..");
  if (parts[0] === "~") throw new SourcePathError("the source path must not start with ~");
}

function normalize(path: string): string {
  return segments(path)
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

function stripPrefix(raw: string): string {
  const match = URL_PREFIX.exec(raw);
  if (!match) return raw;
  const rest = raw.slice(match[0].length);
  const absolute = match[0] === "file://" || match[0] === "/@fs/";
  const decoded = decodeURI(rest);
  return absolute && !decoded.startsWith("/") ? `/${decoded}` : decoded;
}

function isUnder(path: string, base: string): boolean {
  if (base === "") return false;
  const caseless = DRIVE.test(`${base}/`);
  return caseless
    ? path.toLowerCase().startsWith(`${base.toLowerCase()}/`)
    : path.startsWith(`${base}/`);
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function sanitizeSourcePath(raw: string, root: string): string {
  const unified = stripPrefix(raw).replace(/\\/g, "/");
  const base = trimTrailingSlashes(root.replace(/\\/g, "/"));
  const relative = isUnder(unified, base) ? unified.slice(base.length + 1) : unified;
  const candidate =
    relative.startsWith("/") || DRIVE.test(relative) ? relative : normalize(relative);
  assertSafeSourcePath(candidate);
  if (candidate.startsWith("/") || DRIVE.test(candidate)) {
    throw new SourcePathError("the source path is outside the project root");
  }
  return candidate;
}
