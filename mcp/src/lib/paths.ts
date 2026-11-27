import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
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

export function findProjectRoot(start: string, home: string = homedir()): string | undefined {
  const chain: string[] = [];
  // a dotfiles repo or a stray package.json in $HOME must never become the root of every folder below it
  for (
    let dir = resolve(start);
    fold(dir) !== fold(resolve(home)) && dirname(dir) !== dir;
    dir = dirname(dir)
  ) {
    chain.push(dir);
  }
  const marked = chain.find(
    (dir) => existsSync(join(dir, ".git")) || existsSync(join(dir, "DESIGN.md")),
  );
  if (marked) return marked;
  return chain.find((dir) => existsSync(join(dir, "package.json")));
}

export function projectRoot(
  start: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const found = env.NORTHSTAR_ROOT ?? findProjectRoot(start, home) ?? start;
  return realpathSync.native(resolve(found));
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
