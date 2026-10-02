import { PROTOCOL_VERSION } from "@northstar/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostFailure, installFakeHost, missingHost } from "./ext-native-host.js";

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the native port", () => {
  it("sends the versioned envelope and resolves with the result", async () => {
    const posted: unknown[] = [];
    const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } })
      .chrome.runtime;
    const fake = installFakeHost(() => ({ pong: true }));
    const original = runtime.connectNative as () => { postMessage: (m: unknown) => void };
    runtime.connectNative = () => {
      const port = original();
      const post = port.postMessage.bind(port);
      port.postMessage = (message: unknown) => {
        posted.push(message);
        post(message);
      };
      return port;
    };
    const { request } = await import("../extensions/core/src/lib/native.js");
    await expect(request("system.info")).resolves.toEqual({ pong: true });
    expect(posted[0]).toMatchObject({
      version: PROTOCOL_VERSION,
      action: "system.info",
      params: {},
    });
    expect(typeof (posted[0] as { id: string }).id).toBe("string");
    expect(fake.connections).toBe(1);
  });

  it("keeps one port for many requests and answers each by id", async () => {
    const fake = installFakeHost((action) => action);
    const { request } = await import("../extensions/core/src/lib/native.js");
    const answers = await Promise.all([
      request("system.info"),
      request("agent.list"),
      request("session.list"),
    ]);
    expect(answers).toEqual(["system.info", "agent.list", "session.list"]);
    expect(fake.connections).toBe(1);
  });

  it("turns a helper failure into an error with its code, fix and kind", async () => {
    installFakeHost((action) => {
      if (action === "system.info") {
        throw new HostFailure("DAEMON_UNAVAILABLE", "The daemon is down.", "Run northstar daemon.");
      }
      if (action === "agent.list") {
        throw new HostFailure("VERSION_MISMATCH", "Versions differ.", "Update the extension.");
      }
      throw new HostFailure("BAD_REQUEST", "Bad.", "Fix it.");
    });
    const { request } = await import("../extensions/core/src/lib/native.js");
    await expect(request("system.info")).rejects.toMatchObject({
      code: "DAEMON_UNAVAILABLE",
      kind: "offline",
      fix: "Run northstar daemon.",
    });
    await expect(request("agent.list")).rejects.toMatchObject({ kind: "mismatch" });
    await expect(request("session.list")).rejects.toMatchObject({
      kind: "api",
      code: "BAD_REQUEST",
    });
  });

  it("says the helper is not installed and how to install it", async () => {
    missingHost();
    const { request } = await import("../extensions/core/src/lib/native.js");
    await expect(request("system.info")).rejects.toMatchObject({
      message: "Northstar's browser helper is not installed.",
      fix: "Run npm install -g @pallandir/northstar, then northstar install, then reload this page.",
      kind: "offline",
      code: "NO_HELPER",
    });
  });

  it("says when the helper refuses this extension", async () => {
    const fake = installFakeHost(() => null);
    const { request } = await import("../extensions/core/src/lib/native.js");
    const pending = request("system.info");
    fake.disconnect("Access to the specified native messaging host is forbidden.");
    await expect(pending).rejects.toMatchObject({
      message: "The Northstar helper does not allow this extension.",
      fix: expect.stringContaining("start your AI assistant once"),
      code: "NO_HELPER",
    });
  });

  it("rejects every waiting request when the helper stops and reconnects on the next one", async () => {
    const fake = installFakeHost(() => "ok");
    const { request } = await import("../extensions/core/src/lib/native.js");
    await expect(request("system.info")).resolves.toBe("ok");
    const stuck = request("agent.list", {}, 5_000);
    fake.disconnect("Native host has exited.");
    await expect(stuck).rejects.toMatchObject({ code: "HELPER_STOPPED" });
    await expect(request("session.list")).resolves.toBe("ok");
    expect(fake.connections).toBe(2);
  });

  it("gives up with a fix when the helper never answers", async () => {
    vi.useFakeTimers();
    const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } })
      .chrome.runtime;
    runtime.connectNative = () => ({
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
      postMessage: () => {},
      disconnect: () => {},
    });
    const { request } = await import("../extensions/core/src/lib/native.js");
    const pending = request("system.info", {}, 1_000);
    const assertion = expect(pending).rejects.toMatchObject({
      message: "The Northstar helper did not answer in time.",
      code: "HELPER_STOPPED",
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });
});
