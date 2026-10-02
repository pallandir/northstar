import { openTags, realTagEnds } from "../jsx.js";
import type { Check } from "../types.js";

const MARKUP = ["markup", "component"] as const;
const ACTION_TAGS = new Set(["button", "a"]);

export const copyChecks: Check[] = [
  {
    id: "NS-COPY-CTA-VERB",
    kinds: [...MARKUP],
    run(ctx) {
      const vague = ((ctx.param("NS-COPY-CTA-VERB", "vague") as string[] | undefined) ?? []).map(
        (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      if (!vague.length) return;
      const label = new RegExp(`^\\s*(${vague.join("|")})\\s*</(?:button|a)>`, "i");
      for (const tag of openTags(ctx.text, ACTION_TAGS)) {
        if (tag.selfClosing) continue;
        const m = label.exec(ctx.text.slice(tag.end + 1, tag.end + 200));
        if (m) ctx.report("NS-COPY-CTA-VERB", tag.index, `Vague action label "${m[1]}"`);
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
      const ends = realTagEnds(ctx.text);
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        if (ends.has(m.index))
          ctx.report("NS-COPY-FILLER", m.index, `Generic filler copy "${m[1]}"`);
      }
    },
  },
];
