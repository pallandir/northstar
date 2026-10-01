import { describe, expect, it, vi } from "vitest";
import { buildColorPicker, hexToHsv, hsvToHex } from "./color-picker.js";

describe("color picker", () => {
  it("round-trips hex through hsv", () => {
    for (const hex of ["#ff0000", "#1e66f5", "#000000", "#ffffff", "#40a02b"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("reports a new colour when the hue slider moves", () => {
    const onChange = vi.fn();
    const picker = buildColorPicker("#ff0000", onChange);
    const hue = picker.el.querySelector<HTMLInputElement>(".ns-cpick-hue");
    if (!hue) throw new Error("missing hue slider");
    hue.value = "120";
    hue.dispatchEvent(new Event("input"));
    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });

  it("moves the thumb when the colour is set from outside without reporting a change", () => {
    const onChange = vi.fn();
    const picker = buildColorPicker("#000000", onChange);
    picker.set("#ffffff");
    const thumb = picker.el.querySelector<HTMLElement>(".ns-cpick-thumb");
    expect(thumb?.style.left).toBe("0%");
    expect(thumb?.style.top).toBe("0%");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes saturation and brightness from the arrow keys", () => {
    const onChange = vi.fn();
    const picker = buildColorPicker("#ff0000", onChange);
    const area = picker.el.querySelector<HTMLElement>(".ns-cpick-area");
    area?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).not.toBe("#ff0000");
  });
});
