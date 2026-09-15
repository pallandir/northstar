import { describe, expect, it } from "vitest";
import { resolveSource } from "./source-map.js";

describe("resolveSource", () => {
  it("returns null for an element with no inspector attribute", () => {
    const el = document.createElement("div");
    expect(resolveSource(el)).toBeNull();
  });

  describe("React dev-inspector", () => {
    it("reads data-inspector-relative-path / line / column", () => {
      const el = document.createElement("div");
      el.setAttribute("data-inspector-relative-path", "src/Button.tsx");
      el.setAttribute("data-inspector-line", "42");
      el.setAttribute("data-inspector-column", "8");
      const source = resolveSource(el);
      expect(source?.path).toBe("src/Button.tsx");
      expect(source?.line).toBe(42);
      expect(source?.column).toBe(8);
      expect(source?.via).toBe("react-dev-inspector");
    });

    it("defaults column to 0 when data-inspector-column is absent", () => {
      const el = document.createElement("div");
      el.setAttribute("data-inspector-relative-path", "src/Card.tsx");
      el.setAttribute("data-inspector-line", "10");
      const source = resolveSource(el);
      expect(source?.column).toBe(0);
    });

    it("returns null for a path that fails sanitization (traversal)", () => {
      const el = document.createElement("div");
      el.setAttribute("data-inspector-relative-path", "../../etc/passwd");
      el.setAttribute("data-inspector-line", "1");
      expect(resolveSource(el)).toBeNull();
    });
  });

  describe("Vue dev-inspector", () => {
    it("reads data-v-inspector colon-delimited path:line:column", () => {
      const el = document.createElement("div");
      el.setAttribute("data-v-inspector", "src/MyComp.vue:10:4");
      const source = resolveSource(el);
      expect(source?.path).toBe("src/MyComp.vue");
      expect(source?.line).toBe(10);
      expect(source?.column).toBe(4);
      expect(source?.via).toBe("vite-plugin-vue-inspector");
    });

    it("returns null when line segment is missing", () => {
      const el = document.createElement("div");
      el.setAttribute("data-v-inspector", "src/MyComp.vue");
      expect(resolveSource(el)).toBeNull();
    });
  });

  describe("Svelte inspector", () => {
    it("reads data-svelte-source attribute", () => {
      const el = document.createElement("div");
      el.setAttribute("data-svelte-source", "src/App.svelte:20:0");
      const source = resolveSource(el);
      expect(source?.path).toBe("src/App.svelte");
      expect(source?.line).toBe(20);
      expect(source?.column).toBe(0);
      expect(source?.via).toBe("svelte-inspector");
    });

    it("falls back to data-svelte attribute", () => {
      const el = document.createElement("div");
      el.setAttribute("data-svelte", "src/Widget.svelte:5:2");
      const source = resolveSource(el);
      expect(source?.path).toBe("src/Widget.svelte");
      expect(source?.via).toBe("svelte-inspector");
    });
  });

  describe("ancestor traversal", () => {
    it("walks up the DOM to find the inspector attribute on a parent", () => {
      const parent = document.createElement("section");
      parent.setAttribute("data-inspector-relative-path", "src/Section.tsx");
      parent.setAttribute("data-inspector-line", "5");
      parent.setAttribute("data-inspector-column", "0");
      const child = document.createElement("span");
      parent.appendChild(child);
      const source = resolveSource(child);
      expect(source?.path).toBe("src/Section.tsx");
    });

    it("returns null when no ancestor has an inspector attribute", () => {
      const outer = document.createElement("div");
      const inner = document.createElement("span");
      outer.appendChild(inner);
      expect(resolveSource(inner)).toBeNull();
    });
  });
});
