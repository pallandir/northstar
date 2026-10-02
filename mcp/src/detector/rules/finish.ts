import type { Check, Decl } from "../types.js";
import { classLists, commaParts } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const BUTTON_SELECTOR = /button|btn|\[role=["']?button/i;
const BORDER_PROP =
  /^border(-(top|right|bottom|left))?(-color)?$|^outline(-color)?$|^--[\w-]*(border|outline)[\w-]*$/;
const NUMERIC_SELECTOR = /price|amount|total|figure|metric|stat|balance|numeral|counter|kpi/i;
const HEADING_SELECTOR =
  /(^|[\s,>.#])h[12]\b|[-_](title|heading|headline|display|hero)\b|^\.(title|heading|headline|display|hero)\b/i;

function hexToHsl(hex: string): { s: number; l: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const digits = match[1] ?? "";
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { s: 0, l };
  const s = (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

function baseOf(selector: string, pseudo: string): string[] {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.includes(pseudo))
    .map((part) => part.slice(0, part.indexOf(pseudo)).trim());
}

function sameBlock(ctx: { decls: Decl[] }, d: Decl, prop: RegExp): boolean {
  return ctx.decls.some((other) => other.block === d.block && prop.test(other.prop));
}

export const finishChecks: Check[] = [
  {
    id: "NS-FINISH-FLAT-SHADOW",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (d.prop !== "box-shadow" || /^(none|inherit|initial|unset)$/i.test(d.value.trim()))
          continue;
        const layers = commaParts(d.value);
        if (layers.length !== 1) continue;
        const layer = layers[0] ?? "";
        if (/\binset\b/.test(layer) || /var\(/.test(layer)) continue;
        const black =
          /\b(black|#000(000)?)\b/i.test(layer) ||
          /rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\b/.test(layer);
        const lengths = (
          /^(?:inset\s+)?(-?[\d.]+(?:px|rem)?)\s+(-?[\d.]+(?:px|rem)?)\s*(-?[\d.]+(?:px|rem)?)?\s*(-?[\d.]+(?:px|rem)?)?/
            .exec(layer)
            ?.slice(1, 5) ?? []
        ).map((v) => Number.parseFloat(v ?? "0"));
        const blur = lengths[2] ?? 0;
        if (black && blur > 0) ctx.report("NS-FINISH-FLAT-SHADOW", d.index);
      }
    },
  },
  {
    id: "NS-FINISH-PRESS-STATE",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      const selectors = ctx.decls.map((d) => d.selector);
      const reported = new Set<string>();
      for (const d of ctx.decls) {
        if (!d.selector.includes(":hover") || !BUTTON_SELECTOR.test(d.selector)) continue;
        for (const base of baseOf(d.selector, ":hover")) {
          if (!BUTTON_SELECTOR.test(base) || reported.has(base)) continue;
          const pressed = selectors.some((s) => s.includes(`${base}:active`));
          if (!pressed) {
            reported.add(base);
            ctx.report(
              "NS-FINISH-PRESS-STATE",
              d.index,
              `${base} has a hover state and no :active state`,
            );
          }
        }
      }
    },
  },
  {
    id: "NS-FINISH-HOVER-GATE",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      if (/\(\s*hover\s*:\s*hover\s*\)/.test(ctx.text)) return;
      for (const d of ctx.decls) {
        if (d.selector.includes(":hover") && /^(transform|translate|scale)$/.test(d.prop)) {
          ctx.report("NS-FINISH-HOVER-GATE", d.index);
          return;
        }
      }
    },
  },
  {
    id: "NS-FINISH-TABULAR-NUMS",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      for (const d of ctx.decls) {
        if (d.prop !== "font-size" || !NUMERIC_SELECTOR.test(d.selector)) continue;
        const tabular =
          sameBlock(ctx, d, /^font-variant-numeric$/) &&
          ctx.decls.some(
            (o) =>
              o.block === d.block &&
              o.prop === "font-variant-numeric" &&
              /tabular-nums/.test(o.value),
          );
        const feature = ctx.decls.some(
          (o) => o.block === d.block && o.prop === "font-feature-settings" && /tnum/.test(o.value),
        );
        if (!tabular && !feature) ctx.report("NS-FINISH-TABULAR-NUMS", d.index);
      }
    },
  },
  {
    id: "NS-FINISH-TEXT-WRAP",
    kinds: ["css"],
    run(ctx) {
      if (ctx.decls.some((d) => d.prop === "text-wrap" || d.prop === "text-wrap-style")) return;
      const heading = ctx.decls.find(
        (d) => d.prop === "font-size" && HEADING_SELECTOR.test(d.selector),
      );
      if (heading) ctx.report("NS-FINISH-TEXT-WRAP", heading.index);
    },
  },
  {
    id: "NS-FINISH-Z-INDEX",
    kinds: [...ALL],
    run(ctx) {
      const max = Number(ctx.param("NS-FINISH-Z-INDEX", "max") ?? 100);
      for (const d of ctx.decls) {
        if (d.prop === "z-index" && Number.parseInt(d.value, 10) > max) {
          ctx.report("NS-FINISH-Z-INDEX", d.index, `z-index ${d.value} is above ${max}`);
        }
      }
      for (const { str, tokens } of classLists(ctx)) {
        const huge = tokens.find((t) => {
          const match = /^z-\[(\d+)\]$/.exec(t);
          return match ? Number(match[1]) > max : false;
        });
        if (huge) ctx.report("NS-FINISH-Z-INDEX", str.index, `${huge} is above ${max}`);
      }
    },
  },
  {
    id: "NS-FINISH-SATURATED-BORDER",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (!BORDER_PROP.test(d.prop)) continue;
        for (const hex of d.value.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
          const hsl = hexToHsl(hex);
          if (hsl && hsl.s >= 0.6 && hsl.l >= 0.8)
            ctx.report("NS-FINISH-SATURATED-BORDER", d.index);
        }
      }
    },
  },
];
