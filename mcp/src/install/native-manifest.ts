import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID, NATIVE_HOST_NAME } from "@northstar/protocol";
import { binDir, stateDir } from "../lib/home.js";
import { EXTENSION_IDS_FILE } from "../native/host.js";

type HostStatus = "created" | "updated" | "unchanged" | "planned" | "removed" | "missing";

export interface HostResult {
  label: string;
  target: string;
  status: HostStatus;
}

interface HostOptions {
  home: string;
  node: string;
  script: string;
  extensionIds: string[];
  platform?: NodeJS.Platform;
  dryRun?: boolean;
}

const EXTENSION_ID = /^[a-p]{32}$/;

interface HostFile {
  label: string;
  path: string;
  content: string;
  mode: number;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function launcherPath(home: string): string {
  return join(binDir(home), "northstar-native-host");
}

function manifestDirs(
  home: string,
  platform: NodeJS.Platform,
): { chrome: string; firefox: string } {
  if (platform === "darwin") {
    const base = join(home, "Library", "Application Support");
    return {
      chrome: join(base, "Google", "Chrome", "NativeMessagingHosts"),
      firefox: join(base, "Mozilla", "NativeMessagingHosts"),
    };
  }
  if (platform === "linux") {
    return {
      chrome: join(home, ".config", "google-chrome", "NativeMessagingHosts"),
      firefox: join(home, ".mozilla", "native-messaging-hosts"),
    };
  }
  throw new Error(
    `Northstar's native host supports macOS and Linux, ${platform} is not supported yet.`,
  );
}

function assertExtensionIds(ids: readonly string[]): void {
  for (const id of ids) {
    if (!EXTENSION_ID.test(id)) {
      throw new Error(
        `"${id}" is not a Chrome extension id. Copy the 32 letter id from chrome://extensions.`,
      );
    }
  }
}

function hostFiles(options: HostOptions): HostFile[] {
  const platform = options.platform ?? process.platform;
  if (!/\.m?js$/.test(options.script)) {
    throw new Error(
      `The native host needs the built Northstar script, but this run uses ${options.script}. Build the package and run node dist/cli.js install.`,
    );
  }
  assertExtensionIds(options.extensionIds);
  const dirs = manifestDirs(options.home, platform);
  const launcher = launcherPath(options.home);
  const description = "Northstar local bridge";
  const chromeIds = [CHROME_EXTENSION_ID, ...options.extensionIds];
  const files: HostFile[] = [
    {
      label: "native host launcher",
      path: launcher,
      content: `#!/bin/sh\nexec ${quote(options.node)} ${quote(options.script)} native-host "$@"\n`,
      mode: 0o755,
    },
    {
      label: "chrome native host manifest",
      path: join(dirs.chrome, `${NATIVE_HOST_NAME}.json`),
      content: `${JSON.stringify(
        {
          name: NATIVE_HOST_NAME,
          description,
          path: launcher,
          type: "stdio",
          allowed_origins: chromeIds.map((id) => `chrome-extension://${id}/`),
        },
        null,
        2,
      )}\n`,
      mode: 0o644,
    },
    {
      label: "firefox native host manifest",
      path: join(dirs.firefox, `${NATIVE_HOST_NAME}.json`),
      content: `${JSON.stringify(
        {
          name: NATIVE_HOST_NAME,
          description,
          path: launcher,
          type: "stdio",
          allowed_extensions: [FIREFOX_EXTENSION_ID],
        },
        null,
        2,
      )}\n`,
      mode: 0o644,
    },
    {
      label: "allowed extension ids",
      path: join(stateDir(options.home), EXTENSION_IDS_FILE),
      content: `${JSON.stringify({ ids: options.extensionIds }, null, 2)}\n`,
      mode: 0o600,
    },
  ];
  return files;
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function installHost(options: HostOptions): HostResult[] {
  return hostFiles(options).map((file) => {
    const current = readIfPresent(file.path);
    const base = { label: file.label, target: file.path };
    if (current === file.content) return { ...base, status: "unchanged" as const };
    if (options.dryRun) return { ...base, status: "planned" as const };
    mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 });
    writeFileSync(file.path, file.content, { mode: file.mode });
    chmodSync(file.path, file.mode);
    return { ...base, status: current === undefined ? ("created" as const) : ("updated" as const) };
  });
}

export function uninstallHost(
  options: Omit<HostOptions, "node" | "script" | "extensionIds">,
): HostResult[] {
  const files = hostFiles({
    ...options,
    node: "node",
    script: "northstar.js",
    extensionIds: [],
  });
  return files.map((file) => {
    const base = { label: file.label, target: file.path };
    if (!existsSync(file.path)) return { ...base, status: "missing" as const };
    if (options.dryRun) return { ...base, status: "planned" as const };
    rmSync(file.path);
    return { ...base, status: "removed" as const };
  });
}

interface HostCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export function checkHost(options: Omit<HostOptions, "dryRun">): HostCheck[] {
  const checks: HostCheck[] = [];
  let files: HostFile[];
  try {
    files = hostFiles(options);
  } catch (error) {
    return [{ name: "native host", status: "fail", detail: (error as Error).message }];
  }
  for (const file of files) {
    const current = readIfPresent(file.path);
    if (current === undefined) {
      checks.push({
        name: file.label,
        status: "warn",
        detail: `${file.path} is missing, run northstar install`,
      });
    } else if (current !== file.content) {
      checks.push({
        name: file.label,
        status: "warn",
        detail: `${file.path} differs from what install writes, run northstar install`,
      });
    } else {
      checks.push({ name: file.label, status: "ok", detail: file.path });
    }
  }
  const launcher = files[0] as HostFile;
  if (existsSync(launcher.path)) {
    const executable = (statSync(launcher.path).mode & 0o111) !== 0;
    checks.push({
      name: "native host launcher target",
      status: executable && existsSync(options.node) && existsSync(options.script) ? "ok" : "fail",
      detail: `${options.node} ${options.script}${executable ? "" : ", the launcher is not executable"}`,
    });
  }
  return checks;
}
