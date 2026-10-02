import type { Check } from "../types.js";
import { classLists } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const MARKUP = ["markup", "component"] as const;
const SURFACE_PROPS = /^background(-color)?$/;

export const colorChecks: Check[] = [
  {
    id: "NS-COLOR-PURE-BLACK",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (!SURFACE_PROPS.test(d.prop)) continue;
        const value = d.value.trim().toLowerCase();
        const black = /^(#000|#000000|black)$/.test(value);
        const white =
          /^(#fff|#ffffff|white)$/.test(value) && /^(html|body|:root)\b/.test(d.selector);
        if (black || white) ctx.report("NS-COLOR-PURE-BLACK", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        const black = tokens.some(
          (t) => t === "bg-black" || t === "bg-[#000]" || t === "bg-[#000000]",
        );
        const whitePage =
          tokens.includes("bg-white") &&
          tokens.some((t) => t === "min-h-screen" || t === "h-screen");
        if (black || whitePage) ctx.report("NS-COLOR-PURE-BLACK", str.index);
      }
    },
  },
  {
    id: "NS-COLOR-RAW-VALUES",
    kinds: [...MARKUP],
    run(ctx) {
      if (!ctx.designSystem) return;
      for (const { str, tokens } of classLists(ctx)) {
        const raw = tokens.some((t) =>
          /^(bg|text|border|fill|stroke|from|to|via|ring|shadow|outline|decoration|accent|caret)-\[(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/.test(
            t,
          ),
        );
        if (raw) ctx.report("NS-COLOR-RAW-VALUES", str.index);
      }
      for (const d of ctx.decls) {
        if (
          d.selector === "[style]" &&
          /^(color|background(-color)?|border-color|fill|stroke)$/.test(d.prop) &&
          /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(/.test(d.value.trim())
        ) {
          ctx.report("NS-COLOR-RAW-VALUES", d.index);
        }
      }
    },
  },
];
