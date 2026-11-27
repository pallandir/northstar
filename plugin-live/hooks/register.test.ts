import { expect, mock, test } from "claude-code/testing";

const START = { cwd: "/project", surface: "terminal", isInteractive: true } as const;
const LINE = "Resolve the Northstar comments in this project.";

test("a handoff from listen is submitted once as the fixed line, never as comment text", async ($, on) => {
  const clock = mock.clock(on);
  on("fs.read", () => ({ value: JSON.stringify({ version: "9.9.9" }) }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.status", () => ({ value: undefined }));
  on("ui.toast", () => ({ value: undefined }));
  const submitted: string[] = [];
  let runs = 0;
  on("process.run", (_, e) => {
    runs += 1;
    expect(e.init?.env).toEqual({ NORTHSTAR_ROOT: START.cwd });
    expect(e.init?.cwd).not.toBe(START.cwd);
    expect(e.argv).toEqual([
      "npx",
      "-y",
      "@pallandir/northstar@9.9.9",
      "listen",
      "--timeout",
      "55",
    ]);
    return {
      value:
        runs === 1
          ? { exitCode: 0, stdout: `${LINE}\n\nOpen comments:\nc-1 make it blue\n`, stderr: "" }
          : runs === 2
            ? { exitCode: 0, stdout: "No new comments. Run northstar listen again.\n", stderr: "" }
            : { exitCode: 1, stdout: "", stderr: "stop" },
    };
  });
  on("prompt.submit", (_, e) => {
    submitted.push(e.text);
    return { text: e.text };
  });

  await $.session.start(START);
  await clock.advance(5000);

  expect(submitted).toEqual([LINE]);
  expect(runs).toBe(3);
});

test("a failing listen shows why, submits nothing and does not retry", async ($, on) => {
  const clock = mock.clock(on);
  on("fs.read", () => ({ value: JSON.stringify({ version: "9.9.9" }) }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.status", () => ({ value: undefined }));
  on("ui.toast", () => ({ value: undefined }));
  const submitted: string[] = [];
  let runs = 0;
  on("process.run", () => {
    runs += 1;
    return {
      value: { exitCode: 1, stdout: "", stderr: "The Northstar daemon is not reachable." },
    };
  });
  on("prompt.submit", (_, e) => {
    submitted.push(e.text);
    return { text: e.text };
  });

  await $.session.start(START);
  await clock.advance(1000);

  expect(submitted).toEqual([]);
  expect(runs).toBe(1);
});
