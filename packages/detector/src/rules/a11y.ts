import type { Check } from "../types.js";
import { classLists } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const MARKUP = ["markup", "component"] as const;

export const a11yChecks: Check[] = [
  {
    id: "NS-A11Y-FOCUS-VISIBLE",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        const removed =
          (d.prop === "outline" && /^(none|0)(\s|$)/.test(d.value.trim())) ||
          (d.prop === "outline-style" && d.value.trim() === "none");
        const safe = /:focus-visible/.test(d.selector) || /:focus:not\(/.test(d.selector);
        const replaced = ctx.decls.some(
          (other) =>
            other.block === d.block &&
            (other.prop === "box-shadow" || (other.prop.startsWith("outline") && other !== d)),
        );
        if (removed && !safe && !replaced && /:focus/.test(d.selector))
          ctx.report("NS-A11Y-FOCUS-VISIBLE", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        const removed = tokens.includes("outline-none");
        const replaced = str.value
          .split(/\s+/)
          .some((t) => /^(focus-visible|focus):(ring|outline|border|shadow)/.test(t));
        if (removed && !replaced) ctx.report("NS-A11Y-FOCUS-VISIBLE", str.index);
      }
    },
  },
  {
    id: "NS-A11Y-REDUCED-MOTION",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      if (/prefers-reduced-motion/.test(ctx.text)) return;
      const animated = ctx.decls.find(
        (d) =>
          /^animation(-name)?$/.test(d.prop) &&
          !/^(none|inherit|initial|unset)\b/.test(d.value.trim()),
      );
      if (animated) ctx.report("NS-A11Y-REDUCED-MOTION", animated.index);
    },
  },
  {
    id: "NS-A11Y-SEMANTICS",
    kinds: [...MARKUP],
    run(ctx) {
      const clickable = /<(div|span)\b(?![^>]*\brole=)[^>]*\bon[cC]lick=/g;
      for (let m = clickable.exec(ctx.text); m; m = clickable.exec(ctx.text)) {
        ctx.report(
          "NS-A11Y-SEMANTICS",
          m.index,
          `Clickable ${m[1]} without a role, use a button or a link`,
        );
      }
      const image = /<img\b(?![^>]*\balt=)[^>]*>/g;
      for (let m = image.exec(ctx.text); m; m = image.exec(ctx.text)) {
        ctx.report("NS-A11Y-SEMANTICS", m.index, "Image without alternative text");
      }
    },
  },
];
