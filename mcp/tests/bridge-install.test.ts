import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID, NATIVE_HOST_NAME } from "@northstar/protocol";
import {
  BUILTIN_AGENTS,
  findExecutable,
  mergeAgents,
  quickRunArgv,
} from "../src/agents/definitions.js";
import { DaemonLink } from "../src/daemon/link.js";
import { RpcError } from "../src/daemon/rpc.js";
import {
  checkHost,
  installHost,
  launcherPath,
  uninstallHost,
} from "../src/install/native-manifest.js";
import { detectShell, installShell, shellInstalled, uninstallShell } from "../src/install/shell.js";
import { loadSettings, updateSettings } from "../src/user-config.js";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "northstar-bridge-"));
  dirs.push(dir);
  return dir;
}

const host = (home: string, extra: Partial<Parameters<typeof installHost>[0]> = {}) => ({
  home,
  node: "/opt/node's/bin/node",
  script: "/opt/northstar/dist/cli.js",
  extensionIds: [],
  platform: "darwin" as const,
  ...extra,
});

test("the Chrome and Firefox manifests allow exactly the Northstar extension", () => {
  const home = temp();
  installHost(host(home));
  const chrome = JSON.parse(
    readFileSync(
      join(
        home,
        "Library/Application Support/Google/Chrome/NativeMessagingHosts",
        `${NATIVE_HOST_NAME}.json`,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(chrome.allowed_origins, [`chrome-extension://${CHROME_EXTENSION_ID}/`]);
  assert.equal(chrome.name, NATIVE_HOST_NAME);
  assert.equal(chrome.type, "stdio");
  assert.equal(chrome.path, launcherPath(home));
  const firefox = JSON.parse(
    readFileSync(
      join(
        home,
        "Library/Application Support/Mozilla/NativeMessagingHosts",
        `${NATIVE_HOST_NAME}.json`,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(firefox.allowed_extensions, [FIREFOX_EXTENSION_ID]);
  assert.equal("allowed_origins" in firefox, false);
});

test("the launcher pins the absolute node and script and survives quotes in the path", () => {
  const home = temp();
  const node = join(home, "it's a node");
  const script = join(home, "cli.js");
  writeFileSync(node, "#!/bin/sh\nprintf '%s|' \"$@\"\n", { mode: 0o755 });
  writeFileSync(script, "");
  installHost(host(home, { node, script }));
  const launcher = launcherPath(home);
  assert.equal(statSync(launcher).mode & 0o111, 0o111);
  const out = execFileSync(launcher, ["chrome-extension://x/"], { encoding: "utf8", env: {} });
  assert.equal(out, `${script}|native-host|chrome-extension://x/|`);
});

test("an unpacked build is allowed only when its id is passed, and a bad id is refused", () => {
  const home = temp();
  const dev = "abcdefghijklmnopabcdefghijklmnop";
  installHost(host(home, { extensionIds: [dev] }));
  const chrome = JSON.parse(
    readFileSync(
      join(
        home,
        "Library/Application Support/Google/Chrome/NativeMessagingHosts",
        `${NATIVE_HOST_NAME}.json`,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(chrome.allowed_origins, [
    `chrome-extension://${CHROME_EXTENSION_ID}/`,
    `chrome-extension://${dev}/`,
  ]);
  assert.throws(
    () => installHost(host(home, { extensionIds: ["*"] })),
    /not a Chrome extension id/,
  );
  assert.throws(() => installHost(host(home, { extensionIds: ["abc"] })), /32 letter id/);
});

test("installing twice changes nothing, a dry run writes nothing, uninstall removes everything", () => {
  const home = temp();
  const dry = installHost(host(home, { dryRun: true }));
  assert.ok(dry.every((r) => r.status === "planned"));
  assert.equal(existsSync(join(home, ".northstar")), false);

  const first = installHost(host(home));
  assert.ok(first.every((r) => r.status === "created"));
  const second = installHost(host(home));
  assert.ok(second.every((r) => r.status === "unchanged"));

  const removed = uninstallHost({ home, platform: "darwin" });
  assert.ok(removed.every((r) => r.status === "removed"));
  assert.ok(uninstallHost({ home, platform: "darwin" }).every((r) => r.status === "missing"));
});

test("linux manifests go to the Chrome and Firefox directories for that platform", () => {
  const home = temp();
  installHost(host(home, { platform: "linux" }));
  assert.ok(
    existsSync(
      join(home, ".config/google-chrome/NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`),
    ),
  );
  assert.ok(existsSync(join(home, ".mozilla/native-messaging-hosts", `${NATIVE_HOST_NAME}.json`)));
});

test("an unsupported platform and a script that is not built are loud errors", () => {
  const home = temp();
  assert.throws(() => installHost(host(home, { platform: "win32" })), /macOS and Linux/);
  assert.throws(() => installHost(host(home, { script: "/src/cli.ts" })), /built Northstar script/);
});

test("the host check says which file is missing, drifted or pointing at nothing", () => {
  const home = temp();
  const script = join(home, "cli.js");
  writeFileSync(script, "");
  const options = host(home, { node: process.execPath, script });
  assert.ok(checkHost(options).every((c) => c.status === "warn"));
  installHost(options);
  assert.ok(checkHost(options).every((c) => c.status === "ok"));
  rmSync(script);
  const broken = checkHost(options).find((c) => c.name === "native host launcher target");
  assert.equal(broken?.status, "fail");
});

test("shell functions start each agent through northstar run and fall back with a note when it is gone", () => {
  const home = temp();
  const agents = BUILTIN_AGENTS.map((a) => a.id);
  const dry = installShell({ home, shell: "zsh", agents, dryRun: true });
  assert.ok(dry.every((r) => r.status === "planned"));
  assert.equal(existsSync(join(home, ".zshrc")), false);

  const first = installShell({ home, shell: "zsh", agents });
  assert.deepEqual(
    first.map((r) => r.status),
    ["created", "created"],
  );
  const script = readFileSync(join(home, ".northstar/shell/northstar.sh"), "utf8");
  assert.match(script, /claude\(\) \{/);
  assert.match(script, /command northstar run claude "\$@"/);
  assert.match(script, /running claude without Send to AI/);
  assert.ok(shellInstalled(home, "zsh"));
  assert.ok(installShell({ home, shell: "zsh", agents }).every((r) => r.status === "unchanged"));

  const rc = readFileSync(join(home, ".zshrc"), "utf8");
  assert.equal(rc.match(/>>> northstar >>>/g)?.length, 1);

  const out = execFileSync(
    "/bin/sh",
    [
      "-c",
      `. '${join(home, ".northstar/shell/northstar.sh")}'; PATH=/nonexistent; claude --version 2>&1 || true`,
    ],
    { encoding: "utf8" },
  );
  assert.match(out, /northstar is not on the PATH, running claude without Send to AI/);
});

test("uninstalling the shell integration leaves the rest of the rc file alone", () => {
  const home = temp();
  writeFileSync(join(home, ".bashrc"), "export A=1\n");
  installShell({ home, shell: "bash", agents: ["claude"] });
  assert.match(readFileSync(join(home, ".bashrc"), "utf8"), /^export A=1\n# >>> northstar >>>/);
  const removed = uninstallShell({ home, shell: "bash" });
  assert.deepEqual(
    removed.map((r) => r.status),
    ["removed", "updated"],
  );
  assert.equal(readFileSync(join(home, ".bashrc"), "utf8"), "export A=1\n");
  assert.equal(shellInstalled(home, "bash"), false);
});

test("fish gets a conf.d file and an agent id cannot smuggle shell syntax into a function name", () => {
  const home = temp();
  installShell({ home, shell: "fish", agents: ["claude"] });
  assert.match(
    readFileSync(join(home, ".config/fish/conf.d/northstar.fish"), "utf8"),
    /function claude --wraps claude/,
  );
  assert.throws(
    () => installShell({ home, shell: "zsh", agents: ["x; rm -rf ~"] }),
    /not a valid agent id/,
  );
  assert.equal(detectShell("/bin/zsh"), "zsh");
  assert.throws(() => detectShell("/usr/bin/nushell"), /does not know the shell/);
});

test("user settings load defaults, round trip and refuse a bad file with its path", () => {
  const home = temp();
  assert.deepEqual(loadSettings(home), {
    preferredAgent: null,
    template: "resolve",
    agents: [],
    projects: {},
  });
  updateSettings(home, {
    preferredAgent: "claude",
    template: "review",
    projects: { "localhost:3000": "~/work/app" },
    agent: {
      id: "company-ai",
      definition: {
        executable: "/usr/local/bin/company-ai",
        quickRun: { args: ["ask", "{{prompt}}"] },
      },
    },
  });
  const loaded = loadSettings(home);
  assert.equal(loaded.preferredAgent, "claude");
  assert.equal(loaded.template, "review");
  assert.equal(loaded.projects["localhost:3000"], join(home, "work/app"));
  assert.equal(loaded.agents[0]?.id, "company-ai");
  assert.deepEqual(
    mergeAgents(loaded.agents)
      .map((a) => a.id)
      .slice(-1),
    ["company-ai"],
  );

  assert.throws(
    () =>
      updateSettings(home, {
        agent: { id: "bad", definition: { executable: "x", quickRun: { args: ["no prompt"] } } },
      }),
    /must contain \{\{prompt\}\}/,
  );
  mkdirSync(join(home, ".northstar"), { recursive: true });
  writeFileSync(join(home, ".northstar", "config.yaml"), "agents: [");
  assert.throws(() => loadSettings(home), /config\.yaml is not valid YAML/);
  writeFileSync(join(home, ".northstar", "config.yaml"), "unknown: 1\n");
  assert.throws(() => loadSettings(home), /config\.yaml is invalid/);
});

test("agents are found on the PATH and quick run fills the prompt without a shell", () => {
  const home = temp();
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "codex"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o644 });
  assert.equal(findExecutable("codex", bin), join(bin, "codex"));
  assert.equal(findExecutable("claude", bin), null);
  assert.equal(findExecutable("missing", bin), null);
  const claude = BUILTIN_AGENTS.find((a) => a.id === "claude");
  assert.deepEqual(quickRunArgv(claude as (typeof BUILTIN_AGENTS)[number], "the line; rm -rf ~"), [
    "-p",
    "the line; rm -rf ~",
  ]);
});

test("the daemon link reports an unreachable daemon once and never throws into a tool call", async () => {
  const logs: string[] = [];
  const link = new DaemonLink({
    root: temp(),
    log: (m) => logs.push(m),
    connect: async () => {
      throw new RpcError(
        "DAEMON_UNAVAILABLE",
        "The Northstar daemon is not reachable, ENOENT.",
        "Start it.",
      );
    },
    ancestors: async () => [1],
  });
  const status = await link.start();
  assert.equal(status.state, "off");
  link.polled();
  link.bump();
  link.notice({ commentId: "c", page: "p", summary: "s", createdAt: "now" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(logs.filter((l) => /Send to AI is unavailable/.test(l)).length, 1);
});
