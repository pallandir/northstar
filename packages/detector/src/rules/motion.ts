import type { Check } from "../types.js";
import { classLists } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const COMPONENT = ["component"] as const;
const LAYOUT_PROP =
  /^(?:(?:min|max)-)?(?:width|height)$|^(?:top|left|right|bottom|inset)$|^(?:margin|padding)(?:-[a-z]+)?$/;

function commaParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth = Math.max(0, depth - 1);
    else if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function animatesLayout(prop: string, value: string): boolean {
  return commaParts(value).some((part) => {
    const property = prop === "transition" ? part.split(/\s+/)[0] : part;
    return LAYOUT_PROP.test(property ?? "");
  });
}

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
        if (/^transition(-property)?$/.test(d.prop) && animatesLayout(d.prop, d.value)) {
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
        if (/^animation/.test(d.prop) && /\binfinite\b/.test(d.value)) continue;
        if (/(^|[\s,])(ease|ease-in|ease-out|ease-in-out|linear)(\s|,|$)/.test(d.value)) {
          ctx.report("NS-MOTION-EASING", d.index);
        }
      }
    },
  },
];
