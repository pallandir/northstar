import type { Mode, Rule, Severity } from "@northstar/canon";

export type Kind = "css" | "markup" | "component";

export interface Finding {
  rule: string;
  severity: Exclude<Severity, "off">;
  file: string;
  line: number;
  message: string;
  fix: string;
}

export interface Decl {
  selector: string;
  block: number;
  prop: string;
  value: string;
  index: number;
}

export interface Str {
  value: string;
  index: number;
  end: number;
}

export interface Ctx {
  file: string;
  kind: Kind;
  text: string;
  mode: Mode;
  designSystem: boolean;
  strings: Str[];
  decls: Decl[];
  param(ruleId: string, key: string): string | number | string[] | undefined;
  report(ruleId: string, index: number, message?: string): void;
}

export interface Check {
  id: string;
  kinds: Kind[];
  run(ctx: Ctx): void;
}

export interface AllowEntry {
  rule: string;
  reason?: string;
  scope?: string;
}

export interface ScanConfig {
  mode: Mode;
  designSystem: boolean;
  allow: AllowEntry[];
  ignore: string[];
}

export type RuleLookup = Map<string, Rule>;
