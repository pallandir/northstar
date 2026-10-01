import type { Check } from "../types.js";
import { classLists } from "./util.js";

const HEIGHT_PROP = /^(min-|max-)?height$/;
const VIEWPORT_HEIGHT = /(^|[^\w.-])100vh\b/;
const SAFE_UNITS = /\b100(dvh|svh|lvh)\b/;

export const layoutChecks: Check[] = [
  {
    id: "NS-LAYOUT-VIEWPORT-HEIGHT",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      for (const d of ctx.decls) {
        if (!HEIGHT_PROP.test(d.prop) || !VIEWPORT_HEIGHT.test(d.value)) continue;
        const hasDynamic = ctx.decls.some(
          (other) =>
            other.block === d.block && other.prop === d.prop && SAFE_UNITS.test(other.value),
        );
        if (!hasDynamic) ctx.report("NS-LAYOUT-VIEWPORT-HEIGHT", d.index);
      }
      for (const { str, tokens } of classLists(ctx)) {
        const hit = tokens.some(
          (t) => t === "h-screen" || t === "min-h-screen" || /^(min-)?h-\[100vh\]$/.test(t),
        );
        if (hit) ctx.report("NS-LAYOUT-VIEWPORT-HEIGHT", str.index);
      }
    },
  },
];
