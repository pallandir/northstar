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
import { DaemonLink } from "../mcp/src/daemon/link.js";
import { RpcError } from "../mcp/src/daemon/rpc.js";
import { removeLegacyShell } from "../mcp/src/install/legacy-shell.js";
import {
  checkHost,
  installHost,
  launcherPath,
  syncAllowedExtensions,
  uninstallHost,
} from "../mcp/src/install/native-manifest.js";
import { loadSettings, updateSettings } from "../mcp/src/user-config.js";

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

test("an old shell wrapper is removed from the rc files and the function files, and the rest is left alone", () => {
  const home = temp();
  mkdirSync(join(home, ".northstar/shell"), { recursive: true });
  mkdirSync(join(home, ".config/fish/conf.d"), { recursive: true });
  writeFileSync(join(home, ".northstar/shell/northstar.sh"), "function claude {}\n");
  writeFileSync(join(home, ".config/fish/conf.d/northstar.fish"), "function claude\nend\n");
  const block = '# >>> northstar >>>\n[ -f "x" ] && . "x"\n# <<< northstar <<<\n';
  writeFileSync(join(home, ".zshrc"), `export A=1\n${block}export B=2\n`);
  writeFileSync(join(home, ".bashrc"), "export C=3\n");

  const dry = removeLegacyShell(home, true);
  assert.ok(dry.every((r) => r.status === "planned"));
  assert.equal(dry.length, 3);
  assert.match(readFileSync(join(home, ".zshrc"), "utf8"), />>> northstar >>>/);

  const removed = removeLegacyShell(home, false);
  assert.deepEqual(removed.map((r) => r.status).sort(), ["removed", "removed", "updated"]);
  assert.equal(readFileSync(join(home, ".zshrc"), "utf8"), "export A=1\nexport B=2\n");
  assert.equal(readFileSync(join(home, ".bashrc"), "utf8"), "export C=3\n");
  assert.equal(existsSync(join(home, ".northstar/shell/northstar.sh")), false);
  assert.equal(existsSync(join(home, ".config/fish/conf.d/northstar.fish")), false);
  assert.deepEqual(removeLegacyShell(home, false), []);
});

test("user settings load defaults, round trip and refuse a bad file with its path", () => {
  const home = temp();
  assert.deepEqual(loadSettings(home), { template: "resolve", projects: {} });
  updateSettings(home, { template: "review", projects: { "localhost:3000": "~/work/app" } });
  const loaded = loadSettings(home);
  assert.equal(loaded.template, "review");
  assert.equal(loaded.projects["localhost:3000"], join(home, "work/app"));

  mkdirSync(join(home, ".northstar"), { recursive: true });
  writeFileSync(join(home, ".northstar", "config.yaml"), "projects: [");
  assert.throws(() => loadSettings(home), /config\.yaml is not valid YAML/);
  writeFileSync(join(home, ".northstar", "config.yaml"), "unknown: 1\n");
  assert.throws(() => loadSettings(home), /config\.yaml is invalid/);
});

test("a config written by an older version still loads and loses the removed agent settings on the next save", () => {
  const home = temp();
  mkdirSync(join(home, ".northstar"), { recursive: true });
  const path = join(home, ".northstar", "config.yaml");
  writeFileSync(
    path,
    "version: 1\npreferences:\n  preferredAgent: claude\n  template: fix\nagents:\n  mine:\n    executable: /usr/local/bin/mine\nprojects:\n  localhost:3000:\n    directory: /work/app\n",
  );
  assert.deepEqual(loadSettings(home), {
    template: "fix",
    projects: { "localhost:3000": "/work/app" },
  });
  updateSettings(home, { template: "explain" });
  const rewritten = readFileSync(path, "utf8");
  assert.doesNotMatch(rewritten, /preferredAgent|agents|mine/);
  assert.match(rewritten, /template: explain/);
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
  });
  const status = await link.start();
  assert.equal(status.state, "off");
  link.polled();
  link.bump();
  link.notice({ commentId: "c", page: "p", summary: "s", createdAt: "now" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(logs.filter((l) => /Send to AI is unavailable/.test(l)).length, 1);
});

test("syncing allowed extensions rewrites the ids and leaves the launcher alone", () => {
  const home = temp();
  installHost(host(home));
  const launcher = launcherPath(home);
  const before = readFileSync(launcher, "utf8");
  const manifest = join(
    home,
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
    `${NATIVE_HOST_NAME}.json`,
  );
  const id = "p".repeat(32);
  const results = syncAllowedExtensions({ home, extensionIds: [id], platform: "darwin" });
  assert.deepEqual(
    results.map((r) => r.status),
    ["updated", "updated"],
  );
  const chrome = JSON.parse(readFileSync(manifest, "utf8"));
  assert.deepEqual(chrome.allowed_origins, [
    `chrome-extension://${CHROME_EXTENSION_ID}/`,
    `chrome-extension://${id}/`,
  ]);
  assert.equal(readFileSync(launcher, "utf8"), before);
  assert.ok(checkHost({ ...host(home), extensionIds: [id] }).every((c) => c.status !== "warn"));
  assert.deepEqual(
    syncAllowedExtensions({ home, extensionIds: [id], platform: "darwin" }).map((r) => r.status),
    ["unchanged", "unchanged"],
  );
});

test("syncing allowed extensions does nothing before the helper is installed", () => {
  const [result] = syncAllowedExtensions({
    home: temp(),
    extensionIds: [],
    platform: "darwin",
  });
  assert.equal(result?.status, "missing");
});
