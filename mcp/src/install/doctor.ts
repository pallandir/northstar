import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { planAgent } from "@northstar/adapters";
import { validateDesign } from "@northstar/design-md";
import { PROTOCOL_VERSION, SERVER_PORTS, healthSchema } from "@northstar/protocol";
import { getCanon, getData } from "../assets.js";
import { VERSION } from "../config.js";
import { type Runner, findConflicts } from "./conflicts.js";
import { contextForRecord } from "./install.js";
import { northstarPluginInstalled } from "./plugin.js";
import { readRecord } from "./record.js";

export interface Check {
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
  probePorts?: readonly number[];
}

const TOKEN = /^[0-9a-f]{64}$/;

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

type Probe = { port: number; state: "closed" | "northstar" | "other" | "error"; detail?: string };

async function probe(port: number): Promise<Probe> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") return { port, state: "closed" };
    return { port, state: "error", detail: `${(err as Error).name}: ${(err as Error).message}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { port, state: "other" };
  }
  const health = healthSchema.safeParse(body);
  if (!health.success) {
    const older = (body as { service?: unknown } | null)?.service === "northstar";
    return older
      ? { port, state: "northstar", detail: "an older server without a protocol number" }
      : { port, state: "other" };
  }
  return {
    port,
    state: "northstar",
    detail:
      health.data.protocol === PROTOCOL_VERSION
        ? undefined
        : `protocol ${health.data.protocol}, this package speaks ${PROTOCOL_VERSION}`,
  };
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

  const tokenPath = join(process.env.NORTHSTAR_HOME ?? options.home, ".northstar", "token");
  attempt("token", () => {
    const token = readIfPresent(tokenPath)?.trim();
    if (token === undefined) {
      add(
        "token",
        "warn",
        "No pairing token yet. Start the agent once, then click Connect in the Northstar toolbar",
      );
    } else if (!TOKEN.test(token)) {
      add(
        "token",
        "fail",
        `${tokenPath} is not a 64 character hex token, delete it and restart the agent`,
      );
    } else {
      add("token", "ok", tokenPath);
    }
  });

  const probes = await Promise.all((options.probePorts ?? SERVER_PORTS).map(probe));
  const running = probes.filter((p) => p.state === "northstar");
  for (const p of probes.filter((candidate) => candidate.state === "other")) {
    add("ingest", "warn", `port ${p.port} is used by another service, set NORTHSTAR_PORT`);
  }
  for (const p of probes.filter((candidate) => candidate.state === "error")) {
    add("ingest", "warn", `port ${p.port} did not answer (${p.detail})`);
  }
  for (const p of running.filter((candidate) => candidate.detail)) {
    add(
      "ingest",
      "warn",
      `port ${p.port} runs ${p.detail}, update the extension or the server so both match`,
    );
  }
  add(
    "ingest",
    "ok",
    running.length
      ? `listening on ${running.map((p) => p.port).join(", ")}`
      : "not running, normal when no agent session is open",
  );

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
