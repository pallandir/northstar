import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { type Canon, type Rule, loadCanon, severityFor } from "@northstar/canon";
import {
  extractDecls,
  extractEmbeddedDecls,
  extractStrings,
  kindOf,
  lineIndex,
} from "./extract.js";
import { ALL_CHECKS } from "./rules/index.js";
import { allowedInline, compileAllow, compileGlobs } from "./suppress.js";
import type { Ctx, Finding, ScanConfig } from "./types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".git",
  "coverage",
  ".turbo",
  ".jensen",
  ".northstar",
  ".output",
  "vendor",
]);
const MAX_BYTES = 512 * 1024;

interface Prepared {
  config: ScanConfig;
  rules: Map<string, Rule>;
  allowed: (rule: string, path: string) => boolean;
  ignored: { test(path: string): boolean };
}

const rulesByCanon = new WeakMap<Canon, Map<string, Rule>>();

function rulesOf(canon: Canon): Map<string, Rule> {
  let rules = rulesByCanon.get(canon);
  if (!rules) {
    rules = new Map(canon.rules.map((rule) => [rule.id, rule]));
    rulesByCanon.set(canon, rules);
  }
  return rules;
}

function prepare(config: ScanConfig, canon: Canon): Prepared {
  return {
    config,
    rules: rulesOf(canon),
    allowed: compileAllow(config.allow),
    ignored: compileGlobs(config.ignore),
  };
}

export function scanText(file: string, text: string, config: ScanConfig, canon: Canon): Finding[] {
  return scanPrepared(file, text, prepare(config, canon));
}

function scanPrepared(file: string, text: string, { config, rules, allowed }: Prepared): Finding[] {
  const kind = kindOf(file);
  if (!kind) return [];
  const lineOf = lineIndex(text);
  const lines = text.split("\n");
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const ctx: Ctx = {
    file,
    kind,
    text,
    mode: config.mode,
    designSystem: config.designSystem,
    strings: kind === "css" ? [] : extractStrings(text),
    decls: kind === "css" ? extractDecls(text) : extractEmbeddedDecls(text),
    param: (ruleId, key) => rules.get(ruleId)?.params?.[key],
    report: (ruleId, index, message) => {
      const rule = rules.get(ruleId);
      if (!rule) throw new Error(`detector reported unknown rule ${ruleId}`);
      const severity = severityFor(rule, config.mode);
      if (severity === "off") return;
      const line = lineOf(index);
      if (rule.allowable) {
        if (allowedInline(ruleId, lines, line) || allowed(ruleId, file)) return;
      }
      const key = `${ruleId}:${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({
        rule: ruleId,
        severity,
        file,
        line,
        message: message ?? rule.title,
        fix: rule.fix,
      });
    },
  };

  for (const check of ALL_CHECKS) if (check.kinds.includes(kind)) check.run(ctx);
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

export interface ScanResult {
  findings: Finding[];
  scanned: number;
  errors: string[];
  skipped: string[];
}

interface Walk {
  files: string[];
  errors: string[];
  skipped: string[];
}

function walk(root: string, path: string, out: Walk): void {
  const label = relative(root, path).split("\\").join("/") || ".";
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    out.errors.push(
      missing ? `${label} does not exist` : `${label} could not be read: ${(err as Error).message}`,
    );
    return;
  }
  if (stat.isSymbolicLink()) {
    out.skipped.push(label);
    return;
  }
  if (stat.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch (err) {
      out.errors.push(`${label} could not be listed: ${(err as Error).message}`);
      return;
    }
    for (const entry of entries) {
      if (!SKIP_DIRS.has(entry)) walk(root, join(path, entry), out);
    }
  } else if (stat.isFile() && stat.size <= MAX_BYTES && !/\.min\./.test(path)) {
    out.files.push(path);
  }
}

export function scanPaths(
  root: string,
  paths: string[],
  config: ScanConfig,
  canon: Canon = loadCanon(),
): ScanResult {
  const found: Walk = { files: [], errors: [], skipped: [] };
  for (const path of paths.length ? paths : ["."]) walk(root, resolve(root, path), found);
  const prepared = prepare(config, canon);
  const findings: Finding[] = [];
  const errors = [...found.errors];
  let scanned = 0;
  for (const full of found.files) {
    const rel = relative(root, full).split("\\").join("/");
    if (!kindOf(rel) || prepared.ignored.test(rel)) continue;
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch (err) {
      errors.push(`${rel} could not be read: ${(err as Error).message}`);
      continue;
    }
    scanned++;
    findings.push(...scanPrepared(rel, text, prepared));
  }
  return { findings, scanned, errors, skipped: found.skipped };
}

export interface CollectedFiles {
  files: Array<{ file: string; text: string }>;
  errors: string[];
  skipped: string[];
}

export function collectFiles(root: string, paths: string[], config: ScanConfig): CollectedFiles {
  const found: Walk = { files: [], errors: [], skipped: [] };
  for (const path of paths.length ? paths : ["."]) walk(root, resolve(root, path), found);
  const ignored = compileGlobs(config.ignore);
  const files: Array<{ file: string; text: string }> = [];
  const errors = [...found.errors];
  for (const full of found.files) {
    const rel = relative(root, full).split("\\").join("/");
    if (!kindOf(rel) || ignored.test(rel)) continue;
    try {
      files.push({ file: rel, text: readFileSync(full, "utf8") });
    } catch (err) {
      errors.push(`${rel} could not be read: ${(err as Error).message}`);
    }
  }
  return { files, errors, skipped: found.skipped };
}
