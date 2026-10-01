import type { Check } from "../types.js";

const MARKUP = ["markup", "component"] as const;

export const copyChecks: Check[] = [
  {
    id: "NS-COPY-CTA-VERB",
    kinds: [...MARKUP],
    run(ctx) {
      const vague = ((ctx.param("NS-COPY-CTA-VERB", "vague") as string[] | undefined) ?? []).map(
        (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      if (!vague.length) return;
      const pattern = new RegExp(
        `<(?:button|a)\\b[^>]*>\\s*(${vague.join("|")})\\s*</(?:button|a)>`,
        "gi",
      );
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        ctx.report("NS-COPY-CTA-VERB", m.index, `Vague action label "${m[1]}"`);
      }
    },
  },
  {
    id: "NS-COPY-FILLER",
    kinds: [...MARKUP],
    run(ctx) {
      const phrases = ((ctx.param("NS-COPY-FILLER", "phrases") as string[] | undefined) ?? []).map(
        (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      if (!phrases.length) return;
      const pattern = new RegExp(`>[^<>{}]*(${phrases.join("|")})[^<>{}]*<`, "gi");
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        ctx.report("NS-COPY-FILLER", m.index, `Generic filler copy "${m[1]}"`);
      }
    },
  },
];
