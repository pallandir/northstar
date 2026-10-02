import type { Check } from "../types.js";
import { classLists, commaParts } from "./util.js";

const ALL = ["css", "markup", "component"] as const;
const COMPONENT = ["component"] as const;
const LAYOUT_PROP =
  /^(?:(?:min|max)-)?(?:width|height)$|^(?:top|left|right|bottom|inset)$|^(?:margin|padding)(?:-[a-z]+)?$/;

function animatesLayout(prop: string, value: string): boolean {
  return commaParts(value).some((part) => {
    const property = prop === "transition" ? part.split(/\s+/)[0] : part;
    return LAYOUT_PROP.test(property ?? "");
  });
}

const TIMING_PROPS =
  /^(transition|animation|transition-timing-function|animation-timing-function)$/;

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
        if (/(^|[\s,])(ease|ease-out|ease-in-out|linear)(\s|,|$)/.test(d.value)) {
          ctx.report("NS-MOTION-EASING", d.index);
        }
      }
    },
  },
  {
    id: "NS-MOTION-EASE-IN",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        if (!TIMING_PROPS.test(d.prop)) continue;
        if (/^animation/.test(d.prop) && /\binfinite\b/.test(d.value)) continue;
        if (/(^|[\s,])ease-in(\s|,|$)/.test(d.value)) ctx.report("NS-MOTION-EASE-IN", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        if (tokens.includes("ease-in")) ctx.report("NS-MOTION-EASE-IN", str.index);
      }
    },
  },
  {
    id: "NS-MOTION-SCALE-ZERO",
    kinds: [...ALL],
    run(ctx) {
      for (const d of ctx.decls) {
        const zero =
          (d.prop === "transform" && /\bscale(3d|x|y)?\(\s*0(\.0+)?\s*[,)]/.test(d.value)) ||
          (d.prop === "scale" && /^0(\.0+)?(\s|$)/.test(d.value.trim()));
        if (zero) ctx.report("NS-MOTION-SCALE-ZERO", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        if (tokens.includes("scale-0")) ctx.report("NS-MOTION-SCALE-ZERO", str.index);
      }
    },
  },
  {
    id: "NS-MOTION-DURATION",
    kinds: [...ALL],
    run(ctx) {
      const max = Number(ctx.param("NS-MOTION-DURATION", "max_ms") ?? 300);
      for (const d of ctx.decls) {
        if (!/^(transition|transition-duration|animation|animation-duration)$/.test(d.prop))
          continue;
        for (const part of commaParts(d.value)) {
          if (/\binfinite\b/.test(part)) continue;
          const time = /(^|\s)(\d*\.?\d+)(ms|s)(?=\s|$)/.exec(part);
          if (!time) continue;
          const ms = Number(time[2]) * (time[3] === "s" ? 1000 : 1);
          if (ms > max) {
            ctx.report(
              "NS-MOTION-DURATION",
              d.index,
              `Transition of ${ms}ms is longer than ${max}ms`,
            );
          }
        }
      }
      for (const { str, tokens } of classLists(ctx)) {
        const long = tokens.find((t) => {
          const match = /^duration-(?:\[(\d+)ms\]|(\d+))$/.exec(t);
          return match ? Number(match[1] ?? match[2]) > max : false;
        });
        if (long) ctx.report("NS-MOTION-DURATION", str.index, `${long} is longer than ${max}ms`);
      }
    },
  },
];
