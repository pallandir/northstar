import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

const DRIVE = /^[a-zA-Z]:[\\/]/;
const FOLD_CASE = process.platform === "win32" || process.platform === "darwin";

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAbsolutePath(path: string): boolean {
  return isAbsolute(path) || DRIVE.test(path) || path.startsWith("\\\\");
}

function realpathLoose(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(realpathLoose(parent), basename(path));
  }
}

const fold = (path: string) => (FOLD_CASE ? path.toLowerCase() : path);

export function isInside(root: string, path: string): boolean {
  const base = fold(root);
  const full = fold(path);
  return full === base || full.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function resolveInside(root: string, path: string): string {
  const base = realpathLoose(resolve(root));
  const full = realpathLoose(isAbsolute(path) ? resolve(path) : resolve(base, path));
  if (!isInside(base, full)) throw new Error(`path ${path} is outside the project root`);
  return toPosix(relative(base, full)) || ".";
}

export function relativeTarget(root: string, target: string): string | undefined {
  const windows = DRIVE.test(root) || DRIVE.test(target);
  const rel = windows
    ? win32.relative(win32.resolve(root), win32.resolve(root, target))
    : posix.relative(resolve(root), isAbsolute(target) ? resolve(target) : resolve(root, target));
  const unified = toPosix(rel);
  if (unified === ".." || unified.startsWith("../") || isAbsolutePath(unified)) return undefined;
  return unified;
}
