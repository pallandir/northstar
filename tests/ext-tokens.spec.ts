import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The previous design pass claimed a z-scale that was never actually declared: overlay.css
// referenced nine `--cc-z-*` variables that tokens.css defined nowhere, so every one of those
// z-index rules silently resolved to `auto`. This test is what would have caught it.
describe("z-scale", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tokens = readFileSync(join(here, "../extensions/core/src/styles/tokens.css"), "utf8");
  const overlay = readFileSync(join(here, "../extensions/core/src/content/overlay.css"), "utf8");

  const declared = new Set(Array.from(tokens.matchAll(/--ns-z-[a-z-]+(?=:)/g)).map((m) => m[0]));
  const used = new Set(Array.from(overlay.matchAll(/var\((--ns-z-[a-z-]+)\)/g)).map((m) => m[1]));

  it("declares at least one z-scale token", () => {
    expect(declared.size).toBeGreaterThan(0);
  });

  it("every var(--ns-z-*) used in overlay.css has a matching declaration in tokens.css", () => {
    for (const token of used) {
      expect(declared.has(token), `${token} is used but never declared`).toBe(true);
    }
  });

  it("declares no unused z-scale token", () => {
    for (const token of declared) {
      expect(used.has(token), `${token} is declared but never used`).toBe(true);
    }
  });
});

describe("unit discipline", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = [
    "../extensions/core/src/styles/tokens.css",
    "../extensions/core/src/styles/controls.css",
    "../extensions/core/src/content/overlay.css",
  ];

  it("sizes everything in px: rem and em shrink under a page's html font-size", () => {
    for (const file of files) {
      const css = readFileSync(join(here, file), "utf8");
      expect(css.match(/\d(rem|em)\b/g), `${file} uses rem or em`).toBeNull();
    }
  });
});
