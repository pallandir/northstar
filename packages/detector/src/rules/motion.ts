import type { Check } from "../types.js";
import { classLists } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const COMPONENT = ["component"] as const;
const LAYOUT_PROPS = /\b(width|height|top|left|right|bottom|margin|padding)\b/;

export const motionChecks: Check[] = [
  {
    id: "NS-MOTION-TRANSITION-ALL",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        const all =
          (d.prop === "transition" && /(^|[\s,])all(\s|,|$)/.test(d.value)) ||
          (d.prop === "transition-property" && /(^|[\s,])all(\s|,|$)/.test(d.value));
        if (all) ctx.report("NS-MOTION-TRANSITION-ALL", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        if (tokens.includes("transition-all")) ctx.report("NS-MOTION-TRANSITION-ALL", str.index);
      }
    },
  },
  {
    id: "NS-MOTION-BOUNCE",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (/^(animation|animation-name)$/.test(d.prop) && /bounce|elastic|wobble/i.test(d.value)) {
          ctx.report("NS-MOTION-BOUNCE", d.index);
        }
        const bezier =
          /cubic-bezier\(\s*[-\d.]+\s*,\s*(-?[\d.]+)\s*,\s*[-\d.]+\s*,\s*(-?[\d.]+)\s*\)/.exec(
            d.value,
          );
        if (
          bezier &&
          (Number(bezier[1]) > 1.3 ||
            Number(bezier[2]) > 1.3 ||
            Number(bezier[1]) < -0.3 ||
            Number(bezier[2]) < -0.3)
        ) {
          ctx.report("NS-MOTION-BOUNCE", d.index, "Overshooting easing curve");
        }
      }
      for (const { str, tokens } of classLists(ctx)) {
        if (tokens.includes("animate-bounce")) ctx.report("NS-MOTION-BOUNCE", str.index);
      }
    },
  },
  {
    id: "NS-MOTION-PROPERTIES",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (
          /^transition(-property)?$/.test(d.prop) &&
          LAYOUT_PROPS.test(d.value.split(/\s+\d/)[0] ?? d.value)
        ) {
          ctx.report("NS-MOTION-PROPERTIES", d.index);
        }
      }
      for (const { str, tokens } of classLists(ctx)) {
        if (
          tokens.some((t) =>
            /^transition-\[[^\]]*(width|height|top|left|right|bottom|margin|padding)[^\]]*\]$/.test(
              t,
            ),
          )
        ) {
          ctx.report("NS-MOTION-PROPERTIES", str.index);
        }
      }
    },
  },
  {
    id: "NS-MOTION-SCROLLJACK",
    kinds: [...COMPONENT, "markup"],
    run(ctx) {
      const pattern =
        /(?:from\s+|require\(\s*|import\(\s*|src=)["'][^"']*(lenis|locomotive-scroll|smooth-scrollbar|ScrollSmoother)[^"']*["']/g;
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        ctx.report("NS-MOTION-SCROLLJACK", m.index, `${m[1]} hijacks native scrolling`);
      }
    },
  },
  {
    id: "NS-MOTION-SECTION-ENTRANCE",
    kinds: ["markup", "component"],
    run(ctx) {
      const pattern =
        /whileInView|data-aos|animate-fade-in|animate-slide-up|fade-in-up|animate-in\b/g;
      const hits = [...ctx.text.matchAll(pattern)];
      if (hits.length >= 4 && hits[0])
        ctx.report(
          "NS-MOTION-SECTION-ENTRANCE",
          hits[0].index ?? 0,
          `${hits.length} identical entrance animations`,
        );
    },
  },
  {
    id: "NS-MOTION-EASING",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (
          !/^(transition|animation|transition-timing-function|animation-timing-function)$/.test(
            d.prop,
          )
        )
          continue;
        if (/(^|[\s,])(ease|ease-in|ease-out|ease-in-out|linear)(\s|,|$)/.test(d.value)) {
          ctx.report("NS-MOTION-EASING", d.index);
        }
      }
    },
  },
];
