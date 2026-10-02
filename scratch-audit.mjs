import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { loadCanon } = await import("./canon/src/index.ts");
const { captureViewport } = await import("./mcp/src/page/capture.ts");
const { auditSnapshot, mergeViewports } = await import("./mcp/src/page/audit.ts");
const { closeBrowser } = await import("./mcp/src/page/browser.ts");
const canon = loadCanon("canon");
const dir = resolve("tests/fixtures/pages");
const only = process.argv[2];
for (const file of readdirSync(dir).filter(
  (f) => f.endsWith(".html") && (!only || f.includes(only)),
)) {
  const per = [];
  for (const vp of ["mobile", "desktop"]) {
    const { result } = await captureViewport(pathToFileURL(join(dir, file)).href, vp, (snap) => ({
      crops: [],
      result: auditSnapshot(snap, vp, { canon, mode: "persuade", allowed: () => false }),
    }));
    per.push(result);
  }
  console.log("==", file);
  for (const f of mergeViewports(per))
    console.log(
      "  ",
      f.rule,
      f.severity,
      f.viewports.join("+"),
      f.region,
      f.confidence,
      "|",
      f.message.slice(0, 110),
      "|",
      f.evidence.slice(0, 2).join(" ; "),
    );
}
await closeBrowser();
