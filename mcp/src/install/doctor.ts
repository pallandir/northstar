import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { planAgent } from "@northstar/adapters";
import { validateDesign } from "@northstar/design-md";
import { PROTOCOL_VERSION } from "@northstar/protocol";
import { getCanon, getData } from "../assets.js";
import { VERSION } from "../config.js";
import { connectDaemon } from "../daemon/client.js";
import { RpcError } from "../daemon/rpc.js";
import { northstarHome } from "../lib/home.js";
import { extraExtensionIds } from "../native/host.js";
import { type Runner, findConflicts } from "./conflicts.js";
import { contextForRecord } from "./install.js";
import { checkHost } from "./native-manifest.js";
import { northstarPluginInstalled } from "./plugin.js";
import { readRecord } from "./record.js";
import { detectShell, shellInstalled } from "./shell.js";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface HookProbeInput {
  tool_name: string;
  tool_input: { file_path: string };
  cwd: string;
}

export interface DoctorOptions {
  home: string;
  project: string;
  run: Runner;
  scanHook: (input: HookProbeInput) => string | undefined;
  host?: { node: string; script: string };
  loadPty?: () => Promise<unknown>;
}

const FIXTURE_FILE = "Landing.tsx";
const FIXTURE_SOURCE = `export function Landing() {
  return (
    <main className="bg-black text-white">
      <h1 className="bg-gradient-to-r from-purple-500 to-cyan-500 bg-clip-text text-transparent text-7xl">
        Unlock the power of your data
      </h1>
      <img src="/hero.png" />
    </main>
  );
}
`;

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return undefined;
    throw err;
  }
}

function skillVersion(dir: string): string | undefined {
  const text = readIfPresent(join(dir, "SKILL.md"));
  return text === undefined ? undefined : /^\s+version: "?([^"\n]+)"?$/m.exec(text)?.[1];
}

function sameConfig(path: string, current: string, wanted: string): boolean {
  if (!path.endsWith(".json")) return current === wanted;
  return isDeepStrictEqual(JSON.parse(current), JSON.parse(wanted));
}

function hookFixtureCheck(options: DoctorOptions): Check {
  const dir = mkdtempSync(join(tmpdir(), "northstar-doctor-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "*" } }));
    writeFileSync(join(dir, FIXTURE_FILE), FIXTURE_SOURCE);
    const feedback = options.scanHook({
      tool_name: "Edit",
      tool_input: { file_path: FIXTURE_FILE },
      cwd: dir,
    });
    if (!feedback) {
      return {
        name: "hook",
        status: "fail",
        detail:
          "the scan found nothing in a file with a known error, run northstar detect to see why",
      };
    }
    return { name: "hook", status: "ok", detail: "the scan hook finds a known error in a fixture" };
  } catch (err) {
    return { name: "hook", status: "fail", detail: (err as Error).message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function doctor(options: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) =>
    checks.push({ name, status, detail });
  const attempt = (name: string, work: () => void) => {
    try {
      work();
    } catch (err) {
      add(name, "fail", (err as Error).message);
    }
  };

  const major = Number(process.versions.node.split(".")[0]);
  add(
    "node",
    major >= 20 ? "ok" : "fail",
    `Node ${process.versions.node}${major >= 20 ? "" : ", Northstar needs 20 or newer"}`,
  );

  attempt("assets", () => {
    const canon = getCanon();
    const data = getData();
    add(
      "assets",
      "ok",
      `${canon.rules.length} rules, ${Object.values(data.rows).reduce((n, rows) => n + rows.length, 0)} data rows`,
    );
  });

  let installs: ReturnType<typeof readRecord>["installs"] = {};
  attempt("install record", () => {
    installs = readRecord(options.home).installs;
  });
  const entries = Object.values(installs);
  if (!entries.length) add("install", "warn", "No agent is set up yet, run northstar install");

  let plugin = false;
  attempt("claude plugin", () => {
    plugin = northstarPluginInstalled(options.home);
  });

  for (const entry of entries) {
    const label = entry.scope === "project" ? `${entry.agent} (${entry.project})` : entry.agent;
    if (entry.version !== VERSION) {
      add(
        `${label} version`,
        "warn",
        `installed ${entry.version}, package is ${VERSION}, run northstar install again`,
      );
    }
    attempt(`${label} plan`, () => {
      const plan = planAgent(contextForRecord(entry, options.home, options.project, plugin));
      for (const op of plan.ops) {
        const name = `${label} ${op.label}`;
        if (op.kind === "merge") {
          const current = readIfPresent(op.path);
          if (current === undefined) {
            add(
              name,
              "fail",
              `${op.path} is missing, run northstar install --agent ${entry.agent}`,
            );
            continue;
          }
          let same: boolean;
          try {
            same = sameConfig(op.path, current, op.apply(current));
          } catch (err) {
            add(name, "fail", `${op.path} cannot be read: ${(err as Error).message}`);
            continue;
          }
          add(
            name,
            same ? "ok" : "warn",
            same ? op.path : `${op.path} differs from what install writes`,
          );
        } else if (op.kind === "file") {
          const same = readIfPresent(op.path) === op.content;
          add(name, same ? "ok" : "warn", same ? op.path : `${op.path} is missing or out of date`);
        } else if (op.kind === "skill") {
          const found = skillVersion(op.path);
          if (!found) add(name, "fail", `no skill at ${op.path}`);
          else
            add(
              name,
              found === VERSION ? "ok" : "warn",
              found === VERSION ? op.path : `skill is ${found}, package is ${VERSION}`,
            );
        } else {
          try {
            options.run(op.run[0], ["mcp", "get", "northstar"]);
            add(name, "ok", "registered");
          } catch (err) {
            add(
              name,
              "warn",
              `could not confirm the registration (${(err as Error).message}), run claude mcp list`,
            );
          }
        }
      }
      for (const note of plan.notes) add(`${label} note`, "ok", note);
    });
  }

  checks.push(hookFixtureCheck(options));

  const ns = options.home;
  if (options.host) {
    for (const check of checkHost({
      home: options.home,
      node: options.host.node,
      script: options.host.script,
      extensionIds: extraExtensionIds(ns),
    })) {
      add(check.name, check.status, check.detail);
    }
  }

  try {
    await (options.loadPty ?? (() => import("@lydell/node-pty")))();
    add("node-pty", "ok", "the pseudo terminal module loads");
  } catch (err) {
    add(
      "node-pty",
      "fail",
      `the pseudo terminal module did not load: ${(err as Error).message}. Reinstall Northstar with npm install -g @pallandir/northstar`,
    );
  }

  try {
    const peer = await connectDaemon(() => {}, null, northstarHome());
    const info = await peer.call<{ version: string; protocol: number }>("request", {
      action: "system.info",
      params: {},
    });
    peer.close();
    if (info.protocol !== PROTOCOL_VERSION) {
      add(
        "daemon",
        "warn",
        `the daemon speaks protocol ${info.protocol}, this package speaks ${PROTOCOL_VERSION}, run northstar daemon stop`,
      );
    } else {
      add("daemon", "ok", `running, version ${info.version}`);
    }
  } catch (err) {
    if (err instanceof RpcError) {
      add("daemon", "ok", "not running, it starts on demand when you run an agent");
    } else {
      add("daemon", "fail", (err as Error).message);
    }
  }

  let shell: ReturnType<typeof detectShell> | null = null;
  try {
    shell = detectShell();
  } catch (err) {
    add("shell integration", "warn", (err as Error).message);
  }
  if (shell) {
    const installed = shellInstalled(options.home, shell);
    add(
      "shell integration",
      installed ? "ok" : "warn",
      installed
        ? `${shell} starts agents through northstar run`
        : `not installed for ${shell}, run northstar shell install`,
    );
  }

  const designPath = join(options.project, "DESIGN.md");
  if (existsSync(designPath)) {
    attempt("DESIGN.md", () => {
      const canon = getCanon();
      const result = validateDesign(readFileSync(designPath, "utf8"), {
        rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })),
      });
      const errors = result.issues.filter((i) => i.severity === "error").length;
      add(
        "DESIGN.md",
        errors ? "warn" : "ok",
        errors
          ? `${errors} errors, call design_md_validate`
          : result.ready
            ? "valid"
            : `valid with ${result.placeholders} placeholders`,
      );
    });
  }

  attempt("conflicts", () => {
    const conflicts = findConflicts(options.home);
    add(
      "conflicts",
      conflicts.length ? "warn" : "ok",
      conflicts.length ? `${conflicts.length} overlapping skills, run northstar conflicts` : "none",
    );
  });
  return checks;
}
