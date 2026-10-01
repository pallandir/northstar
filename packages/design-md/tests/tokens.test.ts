import assert from "node:assert/strict";
import { test } from "node:test";
import { type Seeds, loadCanon, resolveStyle } from "@northstar/canon";
import {
  TokenError,
  chromaOfHex,
  contrastRatio,
  exportCss,
  exportDtcg,
  exportTailwind,
  generateTokens,
  hueOfHex,
  parseColor,
  renderDesign,
  validateDesign,
} from "../src/index.js";

const canon = loadCanon();
const fonts = { heading: "Geist", body: "Geist", mono: "Geist Mono" };
const options = {
  rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })),
  archetypes: canon.archetypes.archetypes.map((a) => a.id),
};

const ratio = (a: string, b: string) => {
  const x = parseColor(a);
  const y = parseColor(b);
  assert.ok(x && y, `${a} and ${b} must parse`);
  return contrastRatio(x, y);
};

function seeds(hue: number, over: Partial<Seeds> = {}): Seeds {
  return {
    hue,
    chroma: 0.15,
    temperature: "brand",
    shape: "crisp",
    density: "balanced",
    feel: "calm",
    ...over,
  };
}

test("contrast passes in both themes for every hue and every neutral temperature", () => {
  for (let hue = 0; hue < 360; hue += 20) {
    for (const temperature of ["brand", "cool", "warm", "pure"] as const) {
      const t = generateTokens({ seeds: seeds(hue, { temperature }), fonts, mode: "operate" });
      for (const theme of [t.light.colors, t.dark.colors]) {
        const where = `hue ${hue} ${temperature}`;
        assert.ok(ratio(theme.text as string, theme.surface as string) >= 7, `${where} text`);
        assert.ok(
          ratio(theme["text-soft"] as string, theme.muted as string) >= 4.5,
          `${where} soft`,
        );
        assert.ok(
          ratio(theme["on-primary"] as string, theme.primary as string) >= 4.5,
          `${where} on-primary`,
        );
        for (const role of ["primary", "accent", "danger", "success", "warning"]) {
          assert.ok(ratio(theme[role] as string, theme.muted as string) >= 4.5, `${where} ${role}`);
        }
      }
    }
  }
});

test("every archetype generates tokens for each mode it suits", () => {
  for (const a of canon.archetypes.archetypes) {
    for (const mode of a.modes) {
      assert.doesNotThrow(
        () => generateTokens({ seeds: a.seeds, fonts: a.fonts, mode }),
        `${a.id} ${mode}`,
      );
    }
  }
});

test("neutrals are monotonic and never pure black or white", () => {
  const t = generateTokens({ seeds: seeds(250), fonts, mode: "operate" });
  const lum = (hex: string) => {
    const rgb = parseColor(hex) as [number, number, number];
    return rgb[0] + rgb[1] + rgb[2];
  };
  const light = t.neutrals.light.map(lum);
  assert.deepEqual(
    [...light].sort((a, b) => b - a),
    light,
  );
  const dark = t.neutrals.dark.map(lum);
  assert.deepEqual(
    [...dark].sort((a, b) => a - b),
    dark,
  );
  for (const hex of [...t.neutrals.light, ...t.neutrals.dark, t.light.colors.surface as string]) {
    assert.notEqual(hex.toLowerCase(), "#ffffff");
    assert.notEqual(hex.toLowerCase(), "#000000");
  }
});

test("pure temperature keeps neutrals untinted and brand temperature follows the hue", () => {
  const pure = generateTokens({
    seeds: seeds(250, { temperature: "pure" }),
    fonts,
    mode: "operate",
  });
  const mid = pure.neutrals.light[5] as string;
  assert.ok(chromaOfHex(mid) < 0.004);
  const tinted = generateTokens({
    seeds: seeds(250, { temperature: "brand" }),
    fonts,
    mode: "operate",
  });
  const hue = hueOfHex(tinted.neutrals.light[5] as string);
  assert.ok(Math.abs(hue - 250) < 20, `neutral hue ${hue}`);
});

test("radii nest: each step adds the padding of a spacing step", () => {
  for (const shape of ["sharp", "crisp", "soft", "round"] as const) {
    const r = generateTokens({ seeds: seeds(200, { shape }), fonts, mode: "operate" }).rounded;
    const px = (key: string) => Number.parseInt(r[key] as string, 10);
    assert.equal(px("md") - px("sm"), 4);
    assert.equal(px("lg") - px("sm"), 8);
    assert.equal(px("xl") - px("sm"), 16);
  }
});

test("shadows are layered and tinted, never a single black layer", () => {
  const t = generateTokens({ seeds: seeds(200), fonts, mode: "operate" });
  for (const theme of [t.light.elevation, t.dark.elevation]) {
    for (const [name, value] of Object.entries(theme)) {
      assert.ok(value.split("), ").length >= 2, `${name} has several layers`);
    }
  }
  assert.doesNotMatch(t.light.elevation.md as string, /rgb\(0 0 0/);
});

test("type tracking tightens with size and stays above the floor", () => {
  const { typography } = generateTokens({ seeds: seeds(200), fonts, mode: "persuade" });
  const em = (v?: string) => Number.parseFloat(v ?? "0");
  assert.ok(em(typography.display?.letterSpacing) < em(typography.heading?.letterSpacing));
  assert.ok(em(typography.display?.letterSpacing) >= -0.04);
  assert.ok(em(typography.caption?.letterSpacing) > 0);
});

test("motion durations stay at or under 300ms except drawers and expressive feels", () => {
  const calm = generateTokens({
    seeds: seeds(200, { feel: "calm" }),
    fonts,
    mode: "operate",
  }).motion;
  for (const key of ["duration-fast", "duration-base", "duration-slow"]) {
    assert.ok(Number.parseInt(calm[key] as string, 10) <= 300);
  }
});

test("an impossible chroma fails loudly with a fix", () => {
  assert.throws(
    () => generateTokens({ seeds: seeds(100, { chroma: 0.5 }), fonts, mode: "operate" }),
    TokenError,
  );
  assert.throws(
    () => generateTokens({ seeds: seeds(400), fonts, mode: "operate" }),
    /outside 0 to 360/,
  );
});

test("a generated DESIGN.md validates clean and exports every format", () => {
  const style = resolveStyle(canon, "minimalist");
  const tokens = generateTokens({ seeds: style.seeds, fonts: style.fonts, mode: "operate" });
  const markdown = renderDesign(tokens, {
    name: "Ledger",
    description: "Invoices for small teams.",
    mode: "operate",
    stack: "react",
    libraries: { components: "shadcn/ui", icons: "lucide-react", fonts: "@fontsource/geist" },
    archetype: { primary: "minimalist" },
    dials: { variance: 3, motion: 3, density: 5 },
    summary: style.primary.summary,
    depth: style.primary.depth,
    layout: style.primary.layout,
  });
  const result = validateDesign(markdown, options);
  assert.deepEqual(
    result.issues.filter((i) => i.severity === "error"),
    [],
  );
  assert.equal(result.ready, true);
  assert.doesNotMatch(markdown, /[–—]| - /);

  const css = exportCss(markdown);
  assert.match(css, /--shadow-md:/);
  assert.match(css, /--ease-out: cubic-bezier/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(exportTailwind(markdown), /--duration-fast: 100ms/);
  const dtcg = JSON.parse(exportDtcg(markdown));
  assert.equal(dtcg.motion["duration-fast"].$type, "duration");
  assert.equal(dtcg.shadow.md.$type, "shadow");
  assert.ok(Array.isArray(dtcg.shadow.md.$value));
  assert.ok(dtcg.theme.dark.color.background);
});

test("blends take only what a secondary archetype may contribute", () => {
  const blend = resolveStyle(canon, "minimalist", "soft", ["surface", "motion"]);
  assert.equal(blend.seeds.shape, "round");
  assert.equal(blend.seeds.feel, "calm");
  assert.equal(blend.seeds.density, "balanced");
  assert.equal(blend.fonts.heading, "Geist");
  assert.throws(
    () => resolveStyle(canon, "minimalist", "soft"),
    /must say what the secondary contributes/,
  );
  assert.throws(
    () => resolveStyle(canon, "minimalist", "minimalist", ["type"]),
    /different archetypes/,
  );
  assert.throws(
    () => resolveStyle(canon, "minimalist", "soft", ["density" as never]),
    /cannot come from a secondary/,
  );
  assert.throws(() => resolveStyle(canon, "nope"), /unknown archetype/);
});
