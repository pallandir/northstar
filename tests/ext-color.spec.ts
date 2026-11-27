import { describe, expect, it } from "vitest";
import { formatColor, samplePageColors, toHex } from "../extensions/core/src/lib/color.js";

describe("extension colour parsing", () => {
  it("reads CSS Color 4 values", () => {
    expect(toHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(toHex("color(srgb 1 0 0)")).toBe("#ff0000");
    expect(toHex("rgb(255 0 0)")).toBe("#ff0000");
    expect(toHex("#abc")).toBe("#aabbcc");
  });

  it("formats alpha and transparent", () => {
    expect(formatColor("color(srgb 1 0 0 / 0.5)")).toBe("#ff000080");
    expect(formatColor("transparent")).toBe("transparent");
  });

  it("throws on unreadable colours", () => {
    expect(() => toHex("not a colour")).toThrow(/unreadable colour/);
  });

  it("samples modern colours from the page without throwing", () => {
    const el = document.createElement("div");
    el.style.color = "oklch(0.769 0.188 70.08)";
    el.style.backgroundColor = "color(srgb 0.917647 0.701961 0.0313726 / 0.16)";
    document.body.append(el);
    expect(() => samplePageColors(el)).not.toThrow();
    el.remove();
  });
});
