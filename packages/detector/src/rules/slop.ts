import type { Check } from "../types.js";
import { blocks, classLists } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const MARKUP = ["markup", "component"] as const;
const EMOJI_RUN = /\p{Extended_Pictographic}/u;

export const slopChecks: Check[] = [
  {
    id: "NS-SLOP-GRADIENT-TEXT",
    kinds: [...ALL],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const clipped = tokens.includes("bg-clip-text") && tokens.includes("text-transparent");
        if (clipped && tokens.some((t) => /^(bg-gradient-|bg-linear-|from-)/.test(t))) {
          ctx.report("NS-SLOP-GRADIENT-TEXT", str.index);
        }
      }
      for (const group of blocks(ctx.decls)) {
        const clip = group.find((d) => d.prop.endsWith("background-clip") && /text/.test(d.value));
        const gradient = group.some(
          (d) => /^background(-image)?$/.test(d.prop) && /gradient\(/.test(d.value),
        );
        if (clip && gradient) ctx.report("NS-SLOP-GRADIENT-TEXT", clip.index);
      }
    },
  },
  {
    id: "NS-SLOP-SIDE-BORDER",
    kinds: [...ALL],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const thick = tokens.some((t) => /^border-[lr]-(2|4|8|\[[2-9]px\])$/.test(t));
        const coloured = tokens.some((t) =>
          /^border-(?!l-|r-|t-|b-|x-|y-|solid|dashed|dotted|none|collapse|separate|spacing|opacity|0|2|4|8)[a-z]+(-\d{2,3})?$/.test(
            t,
          ),
        );
        if (thick && coloured) ctx.report("NS-SLOP-SIDE-BORDER", str.index);
      }
      for (const d of ctx.decls) {
        const side = /^border-(left|right)(-width)?$/.exec(d.prop);
        if (!side) continue;
        const width = /(\d+(?:\.\d+)?)px/.exec(d.value);
        const hasColour = /#|rgb|hsl|oklch|var\(|[a-z]{3,}$/.test(
          d.value.replace(/solid|dashed|dotted|none/g, ""),
        );
        if (width && Number(width[1]) > 1 && (d.prop.endsWith("width") ? true : hasColour)) {
          ctx.report("NS-SLOP-SIDE-BORDER", d.index);
        }
      }
    },
  },
  {
    id: "NS-SLOP-HARD-SHADOW",
    kinds: [...ALL],
    run(ctx) {
      const hard =
        /(?:^|[\s,])-?[1-9]\d*(?:px)?\s+-?[1-9]\d*(?:px)?\s+0(?:px)?(?:\s+-?\d+(?:px)?)?\s+(?:#|rgb|hsl|oklch|[a-z])/i;
      for (const d of ctx.decls) {
        if (d.prop === "box-shadow" && hard.test(d.value))
          ctx.report("NS-SLOP-HARD-SHADOW", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        if (tokens.some((t) => /^shadow-\[-?[1-9]\d*px_-?[1-9]\d*px_0(px)?_/.test(t))) {
          ctx.report("NS-SLOP-HARD-SHADOW", str.index);
        }
      }
    },
  },
  {
    id: "NS-SLOP-EYEBROW",
    kinds: [...MARKUP],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const label =
          tokens.includes("uppercase") &&
          tokens.some((t) => /^tracking-(wide|wider|widest)$/.test(t)) &&
          tokens.some((t) => /^text-(xs|sm)$/.test(t));
        if (!label) continue;
        const after = ctx.text.slice(str.end, str.end + 260);
        if (/<h[1-3]\b|text-(3|4|5|6|7|8|9)xl/.test(after))
          ctx.report("NS-SLOP-EYEBROW", str.index);
      }
    },
  },
  {
    id: "NS-SLOP-CAPS-LABELS",
    kinds: [...MARKUP],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const label =
          tokens.includes("uppercase") &&
          tokens.some((t) => /^tracking-(wide|wider|widest)$/.test(t)) &&
          tokens.some((t) => /^text-(xs|sm)$/.test(t));
        if (!label) continue;
        const after = ctx.text.slice(str.end, str.end + 260);
        if (!/<h[1-3]\b|text-(3|4|5|6|7|8|9)xl/.test(after))
          ctx.report("NS-SLOP-CAPS-LABELS", str.index);
      }
    },
  },
  {
    id: "NS-SLOP-EMOJI-ICON",
    kinds: [...MARKUP],
    run(ctx) {
      const pattern = />\s*((?:\p{Extended_Pictographic}[️‍]*)+)\s*</gu;
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        if (EMOJI_RUN.test(m[1] ?? "")) ctx.report("NS-SLOP-EMOJI-ICON", m.index);
      }
    },
  },
  {
    id: "NS-SLOP-NUMBERED-SECTIONS",
    kinds: [...MARKUP],
    run(ctx) {
      const found = [...ctx.text.matchAll(/>\s*(0[1-9])\s*</g)];
      const distinct = new Set(found.map((m) => m[1]));
      if (distinct.size >= 3 && found[0])
        ctx.report("NS-SLOP-NUMBERED-SECTIONS", found[0].index ?? 0);
    },
  },
  {
    id: "NS-SLOP-MONO-COSTUME",
    kinds: [...MARKUP],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const costume =
          tokens.includes("font-mono") &&
          (tokens.includes("uppercase") ||
            tokens.some((t) => /^tracking-(wide|wider|widest)$/.test(t))) &&
          tokens.some((t) => /^text-(xs|sm)$/.test(t));
        if (costume) ctx.report("NS-SLOP-MONO-COSTUME", str.index);
      }
    },
  },
  {
    id: "NS-SLOP-DECOR-GLASS",
    kinds: [...ALL],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const blur = tokens.some((t) => /^backdrop-blur(-[a-z0-9]+)?$/.test(t));
        const translucent = tokens.some((t) =>
          /^bg-(white|black|[a-z]+-\d{2,3})\/(5|10|15|20|25|30|40)$/.test(t),
        );
        if (blur && translucent) ctx.report("NS-SLOP-DECOR-GLASS", str.index);
      }
      for (const group of blocks(ctx.decls)) {
        const blur = group.find(
          (d) => d.prop.endsWith("backdrop-filter") && /blur\(/.test(d.value),
        );
        const translucent = group.some(
          (d) =>
            /^background(-color)?$/.test(d.prop) &&
            /(rgba|hsla)\([^)]*,\s*0?\.[0-4]\d*\)|\/\s*0?\.[0-4]\d*\)/.test(d.value),
        );
        if (blur && translucent) ctx.report("NS-SLOP-DECOR-GLASS", blur.index);
      }
    },
  },
  {
    id: "NS-SLOP-TEMPLATE-CHROME",
    kinds: [...MARKUP],
    run(ctx) {
      const middot = />[^<>{}]*[A-Za-z0-9] [·•] [A-Za-z0-9][^<>{}]*</g;
      for (let m = middot.exec(ctx.text); m; m = middot.exec(ctx.text)) {
        ctx.report("NS-SLOP-TEMPLATE-CHROME", m.index, "Middle dot separated metadata");
      }
      const arrow = /<(?:a|button)\b[^>]*>[^<>{}]*→\s*</g;
      for (let m = arrow.exec(ctx.text); m; m = arrow.exec(ctx.text)) {
        ctx.report("NS-SLOP-TEMPLATE-CHROME", m.index, "Arrow appended to a link or button");
      }
    },
  },
  {
    id: "NS-SLOP-SINGLE-WORD-ACCENT",
    kinds: [...MARKUP],
    run(ctx) {
      const pattern =
        /<h[1-3]\b[^>]*>[^<]*<(span|em|i|b|strong)\b[^>]*>\s*[\w'’-]+\s*<\/\1>[^<]*<\/h[1-3]>/g;
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        ctx.report("NS-SLOP-SINGLE-WORD-ACCENT", m.index);
      }
    },
  },
  {
    id: "NS-LOOK-DEFAULT-PALETTE",
    kinds: [...MARKUP],
    run(ctx) {
      for (const { str, tokens } of classLists(ctx)) {
        const from = tokens.some((t) =>
          /^(from|via)-(purple|violet|indigo|fuchsia)-\d{2,3}$/.test(t),
        );
        const to = tokens.some((t) =>
          /^to-(blue|cyan|sky|pink|fuchsia|indigo|violet|purple)-\d{2,3}$/.test(t),
        );
        if (from && to) ctx.report("NS-LOOK-DEFAULT-PALETTE", str.index);
      }
    },
  },
];
