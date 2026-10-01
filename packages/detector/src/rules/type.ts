import type { Check } from "../types.js";
import { HEADING_SELECTOR, classLists, parseRem, tailwindRem } from "./util.js";

const ALL = ["css", "markup", "component"] as const;

export const typeChecks: Check[] = [
  {
    id: "NS-TYPE-DEFAULT-DISPLAY",
    kinds: [...ALL],
    run(ctx) {
      const families =
        (ctx.param("NS-TYPE-DEFAULT-DISPLAY", "families") as string[] | undefined) ?? [];
      for (const d of ctx.decls) {
        if (d.prop !== "font-family" || !HEADING_SELECTOR.test(d.selector)) continue;
        const first = (d.value.split(",")[0] ?? "").replace(/['"]/g, "").trim().toLowerCase();
        if (families.some((family) => family.toLowerCase() === first)) {
          ctx.report("NS-TYPE-DEFAULT-DISPLAY", d.index, `${first} as a display face`);
        }
      }
    },
  },
  {
    id: "NS-TYPE-DISPLAY-MAX",
    kinds: [...ALL],
    run(ctx) {
      const cap = parseRem(String(ctx.param("NS-TYPE-DISPLAY-MAX", ctx.mode) ?? ""));
      if (Number.isNaN(cap)) return;
      for (const d of ctx.decls) {
        if (d.prop !== "font-size" || !HEADING_SELECTOR.test(d.selector)) continue;
        const size = parseRem(d.value);
        if (size > cap)
          ctx.report("NS-TYPE-DISPLAY-MAX", d.index, `Display size above the ${cap}rem cap`);
      }
      for (const { str, tokens } of classLists(ctx)) {
        for (const token of tokens) {
          const named = /^text-(\d?xl)$/.exec(token);
          const arbitrary = /^text-\[([\d.]+(?:rem|px))\]$/.exec(token);
          const size = named
            ? tailwindRem(named[1] ?? "")
            : arbitrary
              ? parseRem(arbitrary[1] ?? "")
              : undefined;
          if (size !== undefined && size > cap) {
            ctx.report("NS-TYPE-DISPLAY-MAX", str.index, `Display size above the ${cap}rem cap`);
          }
        }
      }
    },
  },
  {
    id: "NS-TYPE-MEASURE",
    kinds: [...ALL],
    run(ctx) {
      const max = Number(ctx.param("NS-TYPE-MEASURE", "max_ch") ?? 75);
      for (const d of ctx.decls) {
        const ch = /^max-width$/.test(d.prop) ? /^([\d.]+)ch$/.exec(d.value.trim()) : null;
        if (ch && Number(ch[1]) > max) ctx.report("NS-TYPE-MEASURE", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        const long = tokens.some((t) => {
          const m = /^max-w-\[([\d.]+)ch\]$/.exec(t);
          return m !== null && Number(m[1]) > max;
        });
        if (long) ctx.report("NS-TYPE-MEASURE", str.index);
      }
    },
  },
  {
    id: "NS-TYPE-TRACKING-FLOOR",
    kinds: [...ALL],
    run(ctx) {
      const floor = Number(ctx.param("NS-TYPE-TRACKING-FLOOR", "min_em") ?? -0.04);
      for (const d of ctx.decls) {
        const em = d.prop === "letter-spacing" ? /^(-[\d.]+)em$/.exec(d.value.trim()) : null;
        if (em && Number(em[1]) < floor) ctx.report("NS-TYPE-TRACKING-FLOOR", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        const tight = tokens.some((t) => {
          if (t === "tracking-tighter") return true;
          const m = /^tracking-\[(-[\d.]+)em\]$/.exec(t);
          return m !== null && Number(m[1]) < floor;
        });
        if (tight) ctx.report("NS-TYPE-TRACKING-FLOOR", str.index);
      }
    },
  },
  {
    id: "NS-TYPE-FONT-COUNT",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      const max = Number(ctx.param("NS-TYPE-FONT-COUNT", "max_families") ?? 2);
      const generic =
        /^(sans-serif|serif|monospace|system-ui|ui-[a-z-]+|cursive|fantasy|inherit|initial|unset|var\(.*)$/i;
      const families = new Map<string, number>();
      for (const d of ctx.decls) {
        if (d.prop !== "font-family") continue;
        const first = (d.value.split(",")[0] ?? "").replace(/['"]/g, "").trim();
        if (!first || generic.test(first) || /mono|code|courier/i.test(first)) continue;
        if (!families.has(first.toLowerCase())) families.set(first.toLowerCase(), d.index);
      }
      if (families.size > max) {
        const at = [...families.values()][max] ?? 0;
        ctx.report("NS-TYPE-FONT-COUNT", at, `${families.size} font families in one file`);
      }
    },
  },
];
