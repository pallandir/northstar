import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadCanon } from "@northstar/canon";
import { defaultConfig, kindOf, scanPaths, scanText } from "../mcp/src/detector/index.js";
import { globToRegExp } from "../mcp/src/detector/suppress.js";

const canon = loadCanon();
const scratch = mkdtempSync(join(tmpdir(), "northstar-detector-correct-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const ids = (file: string, text: string, config = defaultConfig()) =>
  scanText(file, text, config, canon).map((f) => f.rule);

test("a role after an arrow function attribute is seen", () => {
  assert.ok(
    !ids("a.tsx", '<div onClick={() => go()} role="button">x</div>').includes("NS-A11Y-SEMANTICS"),
  );
});

test("a clickable div is found even when an earlier attribute holds a comparison", () => {
  assert.ok(
    ids("a.tsx", '<div className={a > b ? "x" : "y"} onClick={go}>x</div>').includes(
      "NS-A11Y-SEMANTICS",
    ),
  );
});

test("alt after an arrow function attribute is seen, a missing alt still is flagged", () => {
  assert.ok(
    !ids("a.tsx", '<img onLoad={() => ready()} alt="Logo" />').includes("NS-A11Y-SEMANTICS"),
  );
  assert.ok(ids("a.tsx", "<img onLoad={() => ready()} src={s} />").includes("NS-A11Y-SEMANTICS"));
});

test("a vague button label is found after an arrow function handler", () => {
  assert.ok(
    ids("a.tsx", "<button onClick={() => save()}>Submit</button>").includes("NS-COPY-CTA-VERB"),
  );
});

test("filler copy is not matched across an arrow", () => {
  assert.ok(
    !ids("a.tsx", "<Row render={(x) => x} data={a}>{lorem}</Row>").includes("NS-COPY-FILLER"),
  );
  assert.ok(ids("a.tsx", "<p>Lorem ipsum dolor</p>").includes("NS-COPY-FILLER"));
});

test("copyright, registered and trademark signs are not emoji icons", () => {
  assert.ok(
    !ids("a.tsx", "<span>©</span><span>®</span><span>™</span>").includes("NS-SLOP-EMOJI-ICON"),
  );
  assert.ok(ids("a.tsx", "<span>🚀</span>").includes("NS-SLOP-EMOJI-ICON"));
  assert.ok(ids("a.tsx", "<span>❤️</span>").includes("NS-SLOP-EMOJI-ICON"));
});

test("option elements do not count as numbered sections", () => {
  const options = "<select><option>01</option><option>02</option><option>03</option></select>";
  assert.ok(!ids("a.tsx", options).includes("NS-SLOP-NUMBERED-SECTIONS"));
  const sections = "<span>01</span><span>02</span><span>03</span>";
  assert.ok(ids("a.tsx", sections).includes("NS-SLOP-NUMBERED-SECTIONS"));
});

test("side border colour is an explicit token list", () => {
  const flagged = (cls: string) =>
    ids("a.tsx", `<div className="border-l-4 ${cls}">x</div>`).includes("NS-SLOP-SIDE-BORDER");
  assert.equal(flagged("border-blue-500/50"), true);
  assert.equal(flagged("border-primary"), true);
  assert.equal(flagged("border-[#3b82f6]"), true);
  assert.equal(flagged("border-transparent"), false);
  assert.equal(flagged("border-hidden"), false);
  assert.equal(flagged("border-current"), false);
});

test("a layout property in the second transition is found", () => {
  assert.ok(
    ids("a.css", ".a{transition:opacity 200ms ease-out, width 300ms ease-out}").includes(
      "NS-MOTION-PROPERTIES",
    ),
  );
  assert.ok(
    ids("a.css", ".a{transition-property:opacity, height}").includes("NS-MOTION-PROPERTIES"),
  );
  assert.ok(
    !ids("a.css", ".a{transition:opacity 200ms ease-out, transform 300ms ease-out}").includes(
      "NS-MOTION-PROPERTIES",
    ),
  );
});

test("an infinite linear spinner is not an easing finding", () => {
  assert.ok(!ids("a.css", ".s{animation:spin 1s linear infinite}").includes("NS-MOTION-EASING"));
  assert.ok(ids("a.css", ".s{transition:opacity 1s linear}").includes("NS-MOTION-EASING"));
  assert.ok(ids("a.css", ".s{animation:fade 1s linear}").includes("NS-MOTION-EASING"));
});

test("overlay libraries are matched by import specifier", () => {
  const roll = '<div role="dialog">x</div>';
  assert.ok(
    ids("a.tsx", `import { Drawer } from "vaul";\n${roll}`).every((r) => r !== "NS-LIB-OVERLAY"),
  );
  assert.ok(ids("a.tsx", `// the vault holds secrets\n${roll}`).includes("NS-LIB-OVERLAY"));
  assert.ok(ids("a.tsx", `import x from "vaulted-thing";\n${roll}`).includes("NS-LIB-OVERLAY"));
  assert.ok(
    !ids("a.tsx", `import { Dialog } from "@radix-ui/react-dialog";\n${roll}`).includes(
      "NS-LIB-OVERLAY",
    ),
  );
  assert.ok(
    !ids("a.tsx", `import { Dialog } from "@/components/ui/dialog";\n${roll}`).includes(
      "NS-LIB-OVERLAY",
    ),
  );
});

test("toast libraries are matched by import specifier", () => {
  const roll = '<div className="toast">x</div>';
  assert.ok(!ids("a.tsx", `import { toast } from "sonner";\n${roll}`).includes("NS-LIB-TOAST"));
  assert.ok(ids("a.tsx", `// sonner is nice\n${roll}`).includes("NS-LIB-TOAST"));
});

test("the icon file exemption matches whole words", () => {
  const svg = `<svg><path d="${"M0 0 L10 10 ".repeat(5)}"/></svg>`;
  assert.ok(!ids("src/UserIcon.tsx", svg).includes("NS-LIB-ICON"));
  assert.ok(!ids("src/icons/user.tsx", svg).includes("NS-LIB-ICON"));
  assert.ok(ids("src/catalog.tsx", svg).includes("NS-LIB-ICON"));
  assert.ok(ids("src/silicon.tsx", svg).includes("NS-LIB-ICON"));
});

test("typescript module extensions are scanned as components", () => {
  assert.equal(kindOf("a.mts"), "component");
  assert.equal(kindOf("a.cts"), "component");
  assert.equal(kindOf("a.json"), null);
});

test("apostrophes in JSX text do not open a string", () => {
  const text = `<p>Don't do this, it's bad</p><div className="bg-gradient-to-r from-pink-500 to-orange-400 bg-clip-text text-transparent">x</div>`;
  assert.ok(ids("a.tsx", text).includes("NS-SLOP-GRADIENT-TEXT"));
  const cls = `<p>it's</p><b className='border-l-4 border-blue-500'>x</b>`;
  assert.ok(ids("a.tsx", cls).includes("NS-SLOP-SIDE-BORDER"));
});

test("the eyebrow and caps label rules stay exclusive", () => {
  const label = (after: string) =>
    ids("a.tsx", `<span className="uppercase tracking-widest text-xs">Hi</span>${after}`);
  assert.ok(label("<h1>Title</h1>").includes("NS-SLOP-EYEBROW"));
  assert.ok(!label("<h1>Title</h1>").includes("NS-SLOP-CAPS-LABELS"));
  assert.ok(label("<p>x</p>").includes("NS-SLOP-CAPS-LABELS"));
});

test("globs treat ** as whole path segments", () => {
  assert.equal(globToRegExp("src/**/x.ts").test("src/a/b/x.ts"), true);
  assert.equal(globToRegExp("src/**/x.ts").test("src/x.ts"), true);
  assert.equal(globToRegExp("src/**/x.ts").test("src/foox.ts"), false);
  assert.equal(globToRegExp("**/x.ts").test("a/b/x.ts"), true);
  assert.equal(globToRegExp("**/x.ts").test("x.ts"), true);
  assert.equal(globToRegExp("**/x.ts").test("ax.ts"), false);
  assert.equal(globToRegExp("src/**").test("src/a/b.ts"), true);
});

test("the walk skips symlinks and reports unreadable or missing paths", () => {
  const dir = join(scratch, "walk");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.tsx"), '<p className="p-4">x</p>');
  symlinkSync(join(dir, "src"), join(dir, "loop"));
  symlinkSync(join(dir, "nowhere"), join(dir, "broken.tsx"));
  const result = scanPaths(dir, ["."], defaultConfig(), canon);
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.sort(), ["broken.tsx", "loop"]);
  const missing = scanPaths(dir, ["gone.tsx"], defaultConfig(), canon);
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0] ?? "", /gone\.tsx.*does not exist/);
});
