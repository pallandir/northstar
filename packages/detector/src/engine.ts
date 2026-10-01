import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
import { allowedByConfig, allowedInline, matchesAny } from "./suppress.js";
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

export function scanText(file: string, text: string, config: ScanConfig, canon: Canon): Finding[] {
  const kind = kindOf(file);
  if (!kind) return [];
  const rules = new Map<string, Rule>(canon.rules.map((rule) => [rule.id, rule]));
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
        if (allowedInline(ruleId, lines, line) || allowedByConfig(ruleId, file, config.allow))
          return;
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

function walk(path: string, out: string[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(join(path, entry), out);
    }
  } else if (stat.isFile() && stat.size <= MAX_BYTES && !/\.min\./.test(path)) {
    out.push(path);
  }
}

export interface ScanResult {
  findings: Finding[];
  scanned: number;
}

export function scanPaths(
  root: string,
  paths: string[],
  config: ScanConfig,
  canon: Canon = loadCanon(),
): ScanResult {
  const files: string[] = [];
  for (const path of paths.length ? paths : ["."]) {
    const full = resolve(root, path);
    if (existsSync(full)) walk(full, files);
  }
  const findings: Finding[] = [];
  let scanned = 0;
  for (const full of files) {
    const rel = relative(root, full).split("\\").join("/");
    if (!kindOf(rel) || matchesAny(rel, config.ignore)) continue;
    scanned++;
    findings.push(...scanText(rel, readFileSync(full, "utf8"), config, canon));
  }
  return { findings, scanned };
}
