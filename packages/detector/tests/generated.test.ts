import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCanon, resolveStyle } from "@northstar/canon";
import { exportCss, exportTailwind, generateTokens, renderDesign } from "@northstar/design-md";
import { defaultConfig, scanText } from "../src/index.js";

const canon = loadCanon();

function documentFor(id: string, mode: "operate" | "read" | "persuade" | "experience") {
  const style = resolveStyle(canon, id);
  const tokens = generateTokens({ seeds: style.seeds, fonts: style.fonts, mode });
  return renderDesign(tokens, {
    name: "Probe",
    description: "A probe system.",
    mode,
    stack: "react",
    libraries: { components: "shadcn/ui", icons: "lucide-react", fonts: "fontsource" },
    archetype: { primary: id },
    dials: style.primary.dials,
    summary: style.primary.summary,
    depth: style.primary.depth,
    layout: style.primary.layout,
  });
}

test("the tokens Northstar generates raise none of its own rules", () => {
  const watched = new Set([
    "NS-LOOK-DEFAULT-PALETTE",
    "NS-COLOR-PURE-BLACK",
    "NS-FINISH-FLAT-SHADOW",
    "NS-FINISH-SATURATED-BORDER",
    "NS-FINISH-Z-INDEX",
    "NS-MOTION-EASE-IN",
    "NS-MOTION-DURATION",
    "NS-MOTION-SCALE-ZERO",
  ]);
  for (const archetype of canon.archetypes.archetypes) {
    for (const mode of archetype.modes) {
      const design = documentFor(archetype.id, mode);
      for (const [name, css] of [
        ["css", exportCss(design)],
        ["tailwind", exportTailwind(design)],
      ] as const) {
        const found = scanText(
          `${archetype.id}-${name}.css`,
          css,
          { ...defaultConfig(), mode },
          canon,
        )
          .filter((f) => watched.has(f.rule))
          .map((f) => `${f.rule} line ${f.line}`);
        assert.deepEqual(found, [], `${archetype.id} ${mode} ${name}`);
      }
    }
  }
});
