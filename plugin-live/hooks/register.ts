import type { Register } from "claude-code";

const WINDOW_SECONDS = 55;
const RESTART_MS = 1000;
const HANDOFF_MARKER = "Open comments:";

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const { version } = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`));
    const argv = [
      "npx",
      "-y",
      `@pallandir/northstar@${version}`,
      "listen",
      "--timeout",
      String(WINDOW_SECONDS),
      "--from",
      e.cwd,
    ];

    const listen = async (): Promise<void> => {
      try {
        const { exitCode, stdout, stderr } = await $.process.run(argv, {
          cwd: $.plugin.root,
          timeoutMs: (WINDOW_SECONDS + 30) * 1000,
        });
        if (exitCode !== 0)
          throw new Error(stderr.trim() || `northstar listen exited with ${exitCode}`);
        const [line] = stdout.split("\n");
        if (line && stdout.includes(HANDOFF_MARKER)) await $.prompt.submit({ text: line });
        $.clock.after(RESTART_MS, listen);
      } catch (error) {
        $.ui.status(undefined);
        $.ui.toast(
          `Northstar stopped listening: ${error instanceof Error ? error.message : String(error)}. Start a new session to listen again.`,
        );
      }
    };

    $.ui.status("Northstar: listening for Send to AI");
    $.clock.after(0, listen);
    return next(e);
  });
};
