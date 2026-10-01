import type { ProjectInfo, ProjectResolution } from "@northstar/protocol";
import type { ProblemNote, ProjectChoice } from "../messages.js";
import { browser } from "./browser.js";
import { UserError } from "./errors.js";
import { BridgeError, request } from "./native.js";

const CHOICE_KEY = "northstar-project-choice";
const SOURCES_KEY = "northstar-page-sources";
const BINDING_TTL_MS = 30_000;

export type Link =
  | { kind: "offline"; problem: ProblemNote }
  | { kind: "mismatch"; problem: ProblemNote }
  | { kind: "noproject" }
  | { kind: "choose"; projects: ProjectInfo[] }
  | { kind: "connected"; root: string };

interface Binding {
  root: string;
  key: string;
  at: number;
}

const bindings = new Map<string, Binding>();

function forgetBindings(): void {
  bindings.clear();
}

export function toChoices(projects: ProjectInfo[]): ProjectChoice[] {
  return projects.map((p) => ({ root: p.root, project: p.name }));
}

export async function reportSources(pageOrigin: string, paths: string[]): Promise<void> {
  const stored = await browser.storage.local.get(SOURCES_KEY);
  const all: unknown = stored[SOURCES_KEY];
  const known = typeof all === "object" && all !== null ? (all as Record<string, string[]>) : {};
  if (known[pageOrigin]?.join("\n") === paths.join("\n")) return;
  await browser.storage.local.set({ [SOURCES_KEY]: { ...known, [pageOrigin]: paths } });
}

async function readSources(pageOrigin: string): Promise<string[]> {
  const stored = await browser.storage.local.get(SOURCES_KEY);
  const all: unknown = stored[SOURCES_KEY];
  const paths =
    typeof all === "object" && all !== null ? (all as Record<string, unknown>)[pageOrigin] : null;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
}

async function readChoices(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(CHOICE_KEY);
  const choices: unknown = stored[CHOICE_KEY];
  return typeof choices === "object" && choices !== null ? (choices as Record<string, string>) : {};
}

export async function chooseProject(pageOrigin: string, root: string): Promise<void> {
  const projects = await request<ProjectInfo[]>("project.list");
  if (!projects.some((p) => p.root === root)) {
    throw new UserError(
      "That project is no longer known to Northstar.",
      "Pick another one.",
      "choose",
    );
  }
  const choices = await readChoices();
  await browser.storage.local.set({ [CHOICE_KEY]: { ...choices, [pageOrigin]: root } });
  bindings.delete(pageOrigin);
}

function problemOf(err: BridgeError): ProblemNote {
  return { error: err.message, fix: err.fix };
}

async function bindBySource(
  pageOrigin: string,
  projects: ProjectInfo[],
  page: string,
): Promise<string | null> {
  const paths = await readSources(pageOrigin);
  const key = paths.join("\n");
  const bound = bindings.get(pageOrigin);
  if (
    bound &&
    bound.key === key &&
    Date.now() - bound.at < BINDING_TTL_MS &&
    projects.some((p) => p.root === bound.root)
  ) {
    return bound.root;
  }
  const resolution = await request<ProjectResolution>("project.resolve", { paths, page });
  if (resolution.mapped && projects.some((p) => p.root === resolution.mapped)) {
    bindings.set(pageOrigin, { root: resolution.mapped, key, at: Date.now() });
    return resolution.mapped;
  }
  const hits = resolution.owners
    .filter((o) => o.matches > 0)
    .sort((a, b) => b.matches - a.matches || b.depth - a.depth);
  const [best, runnerUp] = hits;
  if (best && !(runnerUp && runnerUp.matches === best.matches && runnerUp.depth === best.depth)) {
    bindings.set(pageOrigin, { root: best.root, key, at: Date.now() });
    return best.root;
  }
  bindings.delete(pageOrigin);
  const choice = (await readChoices())[pageOrigin];
  return projects.find((p) => p.root === choice)?.root ?? null;
}

export async function resolveLink(pageOrigin: string, page?: string): Promise<Link> {
  let projects: ProjectInfo[];
  try {
    projects = await request<ProjectInfo[]>("project.list");
  } catch (err) {
    if (err instanceof BridgeError && err.kind === "mismatch") {
      return { kind: "mismatch", problem: problemOf(err) };
    }
    if (err instanceof BridgeError && err.kind === "offline") {
      return { kind: "offline", problem: problemOf(err) };
    }
    throw err;
  }
  if (projects.length === 0) return { kind: "noproject" };
  const first = projects[0] as ProjectInfo;
  if (projects.length === 1) return { kind: "connected", root: first.root };
  const root = await bindBySource(pageOrigin, projects, page ?? `${pageOrigin}/`);
  if (!root) return { kind: "choose", projects };
  return { kind: "connected", root };
}

const offlineError = (link?: Extract<Link, { kind: "offline" }>): UserError =>
  new UserError(
    link?.problem.error ?? "Northstar's browser helper is not reachable.",
    link?.problem.fix ??
      "Run npm install -g @pallandir/northstar, then northstar install, then reload this page.",
    "offline",
  );

export function requireConnected(link: Link): Extract<Link, { kind: "connected" }> {
  switch (link.kind) {
    case "connected":
      return link;
    case "offline":
      throw offlineError(link);
    case "noproject":
      throw new UserError(
        "No project is running yet.",
        "Start your agent in the project with northstar run, then try again.",
        "offline",
      );
    case "choose":
      throw new UserError(
        "More than one project is running.",
        "Pick the project in the Northstar toolbar on a local page, or map this site to a project in the Northstar options.",
        "choose",
      );
    case "mismatch":
      throw new UserError(link.problem.error, link.problem.fix, "mismatch");
  }
}

export function callProject<T>(
  link: Extract<Link, { kind: "connected" }>,
  action: Parameters<typeof request>[0],
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<T> {
  return request<T>(action, { root: link.root, ...params }, timeoutMs).catch((err: unknown) => {
    if (err instanceof BridgeError && err.code === "NO_PROJECT") forgetBindings();
    throw err;
  });
}
