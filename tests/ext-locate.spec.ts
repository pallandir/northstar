import { beforeEach, describe, expect, it } from "vitest";
import { buildLocate, captureSemantics, deriveIntent } from "../extensions/core/src/lib/locate.js";
import type { Target } from "../extensions/core/src/types.js";

const target = (overrides: Partial<Target> = {}): Target => ({
  selector: "main > button.cta",
  tag: "button",
  id: null,
  testId: "signup",
  role: "button",
  ariaLabel: null,
  classes: [],
  attributes: {},
  ownText: "Join for free",
  ancestors: [],
  rect: { x: 0, y: 0, w: 10, h: 10 },
  outerHtml: "",
  ...overrides,
});

describe("locate", () => {
  beforeEach(() => {
    document.body.innerHTML = `<main aria-label="Landing"><section><h2>Get started</h2><button id="b">Join for free</button></section></main>`;
  });

  it("captures role, accessible name, landmark and nearest heading", () => {
    const el = document.getElementById("b") as Element;
    expect(captureSemantics(el, target())).toEqual({
      ariaRole: "button",
      ariaName: "Join for free",
      landmark: "region",
      heading: "Get started",
    });
  });

  it("orders hints from most to least reliable and skips missing ones", () => {
    const hints = buildLocate({
      source: { path: "src/Cta.tsx", line: 4, column: 2, via: "react-fiber" },
      component: { stack: [{ name: "Cta" }, { name: "Hero" }] },
      route: null,
      target: target(),
      semantics: { ariaRole: "button", ariaName: "Join", landmark: null, heading: null },
      elementText: "Join for free",
    });
    expect(hints.map((h) => h.kind)).toEqual([
      "source",
      "component",
      "testId",
      "aria",
      "text",
      "selector",
    ]);
    expect(hints[0]?.value).toBe("src/Cta.tsx:4:2");
    expect(hints[1]?.value).toBe("Cta < Hero");
  });

  it("derives intent from the operation", () => {
    expect(deriveIntent({ type: "style", property: "color", from: "a", to: "b" })).toBe("style");
    expect(deriveIntent({ type: "text", property: null, from: "a", to: "b" })).toBe("copy");
    expect(deriveIntent({ type: "comment", property: null, from: null, to: null })).toBe("change");
  });
});
