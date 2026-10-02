import assert from "node:assert/strict";
import { test } from "node:test";
import { type Mode, loadCanon } from "@northstar/canon";
import { ALL_CHECKS, defaultConfig, scanText } from "../mcp/src/detector/index.js";

const canon = loadCanon();

interface Case {
  rule: string;
  file: string;
  bad: string;
  good: string;
  mode?: Mode;
  designSystem?: boolean;
}

const CASES: Case[] = [
  {
    rule: "NS-SLOP-GRADIENT-TEXT",
    file: "a.tsx",
    bad: '<h1 className="bg-gradient-to-r from-pink-500 to-orange-400 bg-clip-text text-transparent">Hi</h1>',
    good: '<h1 className="text-4xl font-semibold">Hi</h1>',
  },
  {
    rule: "NS-SLOP-GRADIENT-TEXT",
    file: "a.css",
    bad: ".t{background-image:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;color:transparent}",
    good: ".t{color:#222}",
  },
  {
    rule: "NS-SLOP-SIDE-BORDER",
    file: "a.tsx",
    bad: '<div className="border-l-4 border-blue-500 p-4">x</div>',
    good: '<div className="border border-blue-500 p-4">x</div>',
  },
  {
    rule: "NS-SLOP-SIDE-BORDER",
    file: "a.css",
    bad: ".a{border-left:4px solid #3b82f6}",
    good: ".a{border-left:1px solid #cccccc}",
  },
  {
    rule: "NS-SLOP-HARD-SHADOW",
    file: "a.css",
    bad: ".c{box-shadow:4px 4px 0 #000}",
    good: ".c{box-shadow:0 4px 12px rgba(0,0,0,.1)}",
  },
  {
    rule: "NS-SLOP-HARD-SHADOW",
    file: "a.tsx",
    bad: '<div className="shadow-[4px_4px_0_#000]" />',
    good: '<div className="shadow-md" />',
  },
  {
    rule: "NS-SLOP-EYEBROW",
    file: "a.tsx",
    bad: '<p className="text-xs uppercase tracking-widest">Features</p><h2 className="text-3xl">Build</h2>',
    good: '<h2 className="text-3xl">Build</h2>',
  },
  {
    rule: "NS-SLOP-CAPS-LABELS",
    file: "a.tsx",
    bad: '<span className="text-xs uppercase tracking-wider">Status</span>',
    good: '<span className="text-sm">Status</span>',
  },
  {
    rule: "NS-SLOP-EMOJI-ICON",
    file: "a.tsx",
    bad: "<span>🚀</span>",
    good: "<span>Rocket</span>",
  },
  {
    rule: "NS-SLOP-NUMBERED-SECTIONS",
    file: "a.tsx",
    bad: "<i>01</i><i>02</i><i>03</i>",
    good: "<i>01</i><i>02</i>",
  },
  {
    rule: "NS-SLOP-MONO-COSTUME",
    file: "a.tsx",
    bad: '<span className="font-mono text-xs uppercase">DATA</span>',
    good: '<code className="font-mono text-sm">x</code>',
  },
  {
    rule: "NS-SLOP-DECOR-GLASS",
    file: "a.tsx",
    bad: '<div className="backdrop-blur-md bg-white/10 p-4" />',
    good: '<div className="bg-white p-4" />',
  },
  {
    rule: "NS-SLOP-TEMPLATE-CHROME",
    file: "a.tsx",
    bad: "<p>Design · Build · Ship</p>",
    good: "<p>Design, build, ship</p>",
  },
  {
    rule: "NS-SLOP-TEMPLATE-CHROME",
    file: "a.tsx",
    bad: '<a href="/x">Learn →</a>',
    good: '<a href="/x">Learn how it works</a>',
  },
  {
    rule: "NS-SLOP-SINGLE-WORD-ACCENT",
    file: "a.tsx",
    bad: '<h1>Build <span className="text-blue-500">faster</span> today</h1>',
    good: "<h1>Build faster today</h1>",
  },
  {
    rule: "NS-LOOK-DEFAULT-PALETTE",
    file: "a.tsx",
    bad: '<div className="bg-gradient-to-r from-purple-500 to-cyan-500" />',
    good: '<div className="bg-gradient-to-r from-emerald-500 to-teal-500" />',
  },
  {
    rule: "NS-TYPE-DEFAULT-DISPLAY",
    file: "a.css",
    bad: "h1{font-family:'Space Grotesk',sans-serif}",
    good: "h1{font-family:'Bricolage Grotesque',sans-serif} body{font-family:Inter,sans-serif}",
  },
  {
    rule: "NS-TYPE-DISPLAY-MAX",
    file: "a.tsx",
    mode: "operate",
    bad: '<h1 className="text-7xl">x</h1>',
    good: '<h1 className="text-4xl">x</h1>',
  },
  {
    rule: "NS-TYPE-DISPLAY-MAX",
    file: "a.css",
    mode: "operate",
    bad: "h1{font-size:clamp(2rem,8vw,7rem)}",
    good: "h1{font-size:clamp(1.5rem,4vw,2.5rem)}",
  },
  {
    rule: "NS-TYPE-DISPLAY-MAX",
    file: "a.tsx",
    mode: "persuade",
    bad: '<h1 className="text-9xl">x</h1>',
    good: '<h1 className="text-8xl">x</h1>',
  },
  {
    rule: "NS-TYPE-MEASURE",
    file: "a.tsx",
    bad: '<p className="max-w-[90ch]">x</p>',
    good: '<p className="max-w-prose">x</p>',
  },
  { rule: "NS-TYPE-MEASURE", file: "a.css", bad: "p{max-width:100ch}", good: "p{max-width:65ch}" },
  {
    rule: "NS-TYPE-TRACKING-FLOOR",
    file: "a.tsx",
    bad: '<h1 className="tracking-tighter">x</h1>',
    good: '<h1 className="tracking-tight">x</h1>',
  },
  {
    rule: "NS-TYPE-TRACKING-FLOOR",
    file: "a.css",
    bad: "h1{letter-spacing:-0.06em}",
    good: "h1{letter-spacing:-0.02em}",
  },
  {
    rule: "NS-TYPE-FONT-COUNT",
    file: "a.css",
    bad: "h1{font-family:Alpha} h2{font-family:Beta} p{font-family:Gamma}",
    good: "h1{font-family:Alpha} p{font-family:Beta} code{font-family:'JetBrains Mono'}",
  },
  {
    rule: "NS-COLOR-PURE-BLACK",
    file: "a.css",
    bad: "body{background:#000}",
    good: "body{background:#0f1419}",
  },
  {
    rule: "NS-COLOR-PURE-BLACK",
    file: "a.tsx",
    bad: '<div className="bg-black" />',
    good: '<div className="bg-neutral-950" />',
  },
  {
    rule: "NS-COLOR-RAW-VALUES",
    file: "a.tsx",
    designSystem: true,
    bad: '<div className="bg-[#ff5500]" />',
    good: '<div className="bg-primary" />',
  },
  {
    rule: "NS-MOTION-TRANSITION-ALL",
    file: "a.css",
    bad: ".a{transition:all .2s}",
    good: ".a{transition:opacity .2s}",
  },
  {
    rule: "NS-MOTION-TRANSITION-ALL",
    file: "a.tsx",
    bad: '<div className="transition-all" />',
    good: '<div className="transition-colors" />',
  },
  {
    rule: "NS-MOTION-BOUNCE",
    file: "a.css",
    bad: ".a{animation:bounce 1s infinite}",
    good: ".a{animation:fade 1s}",
  },
  {
    rule: "NS-MOTION-BOUNCE",
    file: "a.tsx",
    bad: '<div className="animate-bounce" />',
    good: '<div className="animate-pulse" />',
  },
  {
    rule: "NS-MOTION-PROPERTIES",
    file: "a.css",
    bad: ".a{transition:width .3s ease}",
    good: ".a{transition:opacity .3s cubic-bezier(.16,1,.3,1)}",
  },
  {
    rule: "NS-MOTION-PROPERTIES",
    file: "a.tsx",
    bad: '<div className="transition-[height]" />',
    good: '<div className="transition-[opacity]" />',
  },
  {
    rule: "NS-MOTION-EASING",
    file: "a.css",
    bad: ".a{transition:opacity .2s ease-in-out}",
    good: ".a{transition:opacity .2s cubic-bezier(.16,1,.3,1)}",
  },
  {
    rule: "NS-MOTION-SCROLLJACK",
    file: "a.tsx",
    bad: 'import Lenis from "lenis";',
    good: 'import { motion } from "motion/react";',
  },
  {
    rule: "NS-MOTION-SECTION-ENTRANCE",
    file: "a.tsx",
    bad: "<A whileInView={x}/><B whileInView={x}/><C whileInView={x}/><D whileInView={x}/>",
    good: "<A whileInView={x}/>",
  },
  {
    rule: "NS-A11Y-FOCUS-VISIBLE",
    file: "a.tsx",
    bad: '<button className="outline-none bg-blue-600">x</button>',
    good: '<button className="outline-none focus-visible:ring-2">x</button>',
  },
  {
    rule: "NS-A11Y-FOCUS-VISIBLE",
    file: "a.css",
    bad: "button:focus{outline:none}",
    good: "button:focus{outline:none;box-shadow:0 0 0 2px blue}",
  },
  {
    rule: "NS-A11Y-REDUCED-MOTION",
    file: "a.css",
    bad: ".a{animation:spin 1s linear infinite}",
    good: ".a{animation:spin 1s linear infinite} @media (prefers-reduced-motion: reduce){.a{animation:none}}",
  },
  {
    rule: "NS-A11Y-SEMANTICS",
    file: "a.tsx",
    bad: "<div onClick={go}>x</div>",
    good: "<button onClick={go}>x</button>",
  },
  {
    rule: "NS-A11Y-SEMANTICS",
    file: "a.tsx",
    bad: '<img src="a.png">',
    good: '<img src="a.png" alt="">',
  },
  {
    rule: "NS-LIB-ICON",
    file: "Button.tsx",
    bad: '<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
    good: "<Search />",
  },
  {
    rule: "NS-LIB-OVERLAY",
    file: "Modal.tsx",
    bad: '<div role="dialog" aria-modal="true">x</div>',
    good: 'import * as Dialog from "@radix-ui/react-dialog"; <div role="dialog">x</div>',
  },
  {
    rule: "NS-LIB-FONT",
    file: "a.css",
    bad: "@font-face{font-family:X;src:url(x.woff2)}",
    good: "h1{font-family:X}",
  },
  {
    rule: "NS-LIB-TOAST",
    file: "Toast.tsx",
    bad: '<div className="toast">Saved</div>',
    good: 'import { toast } from "sonner"; <div className="toast">Saved</div>',
  },
  {
    rule: "NS-COPY-CTA-VERB",
    file: "a.tsx",
    bad: "<button>Submit</button>",
    good: "<button>Save changes</button>",
  },
  {
    rule: "NS-COPY-FILLER",
    file: "a.tsx",
    bad: "<p>Unlock the power of your data</p>",
    good: "<p>Track invoices by customer.</p>",
  },
  {
    rule: "NS-FINISH-TEXT-WRAP",
    file: "a.css",
    bad: "h1{font-size:2rem}",
    good: "h1{font-size:2rem;text-wrap:balance}",
  },
  { rule: "NS-FINISH-Z-INDEX", file: "a.css", bad: ".a{z-index:9999}", good: ".a{z-index:40}" },
  {
    rule: "NS-MOTION-SCALE-ZERO",
    file: "a.css",
    bad: ".a{transform:scale(0)}",
    good: ".a{transform:scale(0.95)}",
  },
  {
    rule: "NS-MOTION-DURATION",
    file: "a.css",
    bad: ".a{transition:opacity 600ms}",
    good: ".a{transition:opacity 200ms}",
  },
  {
    rule: "NS-LAYOUT-VIEWPORT-HEIGHT",
    file: "a.css",
    bad: ".a{min-height:100vh}",
    good: ".a{min-height:100vh;min-height:100dvh}",
  },
  {
    rule: "NS-LAYOUT-VIEWPORT-HEIGHT",
    file: "a.tsx",
    bad: '<div className="min-h-screen" />',
    good: '<div className="min-h-dvh" />',
  },
  {
    rule: "NS-FINISH-FLAT-SHADOW",
    file: "a.css",
    bad: ".a{box-shadow:0 4px 12px rgba(0,0,0,.2)}",
    good: ".a{box-shadow:0 1px 2px rgba(20,24,40,.08),0 4px 12px rgba(20,24,40,.06)}",
  },
  {
    rule: "NS-FINISH-PRESS-STATE",
    file: "a.css",
    bad: ".btn:hover{opacity:.9}",
    good: ".btn:hover{opacity:.9}.btn:active{transform:scale(.97)}",
  },
  {
    rule: "NS-FINISH-HOVER-GATE",
    file: "a.css",
    bad: ".card:hover{transform:translateY(-2px)}",
    good: "@media (hover: hover){.card:hover{transform:translateY(-2px)}}",
  },
  {
    rule: "NS-FINISH-TABULAR-NUMS",
    file: "a.css",
    bad: ".price{font-size:2rem}",
    good: ".price{font-size:2rem;font-variant-numeric:tabular-nums}",
  },
  {
    rule: "NS-FINISH-TEXT-WRAP",
    file: "a.css",
    bad: "h1{font-size:2rem}",
    good: "h1{font-size:2rem;text-wrap:balance}",
  },
  {
    rule: "NS-FINISH-SATURATED-BORDER",
    file: "a.css",
    bad: ".a{border:1px solid #dbeafe}",
    good: ".a{border:1px solid #e5e7eb}",
  },
  {
    rule: "NS-MOTION-EASE-IN",
    file: "a.css",
    bad: ".a{transition:opacity 150ms ease-in}",
    good: ".a{transition:opacity 150ms ease-out}",
  },
  {
    rule: "NS-MOTION-SCALE-ZERO",
    file: "a.css",
    bad: ".a{transform:scale(0)}",
    good: ".a{transform:scale(0.95)}",
  },
  {
    rule: "NS-MOTION-DURATION",
    file: "a.css",
    bad: ".a{transition:opacity 600ms}",
    good: ".a{transition:opacity 200ms}",
  },
  {
    rule: "NS-MOTION-DURATION",
    file: "a.tsx",
    bad: '<div className="duration-700" />',
    good: '<div className="duration-200" />',
  },
];

function run(c: Case, source: string) {
  const config = {
    ...defaultConfig(),
    mode: c.mode ?? "persuade",
    designSystem: c.designSystem ?? false,
  };
  return scanText(c.file, source, config, canon).filter((f) => f.rule === c.rule);
}

for (const c of CASES) {
  test(`${c.rule} flags ${c.file} and passes the clean version`, () => {
    assert.ok(run(c, c.bad).length > 0, "expected a finding on the bad snippet");
    assert.deepEqual(run(c, c.good), [], "expected no finding on the good snippet");
  });
}

test("raw colour values are only flagged when a design system exists", () => {
  const source = '<div className="bg-[#ff5500]" />';
  const without = scanText("a.tsx", source, { ...defaultConfig(), designSystem: false }, canon);
  assert.equal(without.filter((f) => f.rule === "NS-COLOR-RAW-VALUES").length, 0);
});

test("every static canon rule has a check and every check maps to a canon rule", () => {
  const ids = new Set(ALL_CHECKS.map((c) => c.id));
  const staticRules = canon.rules.filter((r) => r.detect === "static").map((r) => r.id);
  assert.deepEqual(
    staticRules.filter((id) => !ids.has(id)),
    [],
  );
  assert.deepEqual(
    [...ids].filter((id) => !canon.rules.some((r) => r.id === id)),
    [],
  );
});

test("every check is exercised by at least one case", () => {
  const covered = new Set(CASES.map((c) => c.rule));
  assert.deepEqual(
    ALL_CHECKS.map((c) => c.id).filter((id) => !covered.has(id)),
    [],
  );
});
