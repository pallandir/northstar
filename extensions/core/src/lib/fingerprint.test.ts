import { afterEach, describe, expect, it } from "vitest";
import { captureElement } from "./fingerprint.js";

// Clean up body children after each test so they don't interfere
const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardowns.splice(0)) fn();
});

function mount<T extends Element>(el: T): T {
  document.body.appendChild(el);
  teardowns.push(() => document.body.contains(el) && document.body.removeChild(el));
  return el;
}

describe("captureElement", () => {
  it("builds an xpath rooted at /html for a body child", () => {
    const el = mount(document.createElement("button"));
    const { operator } = captureElement(el);
    expect(operator).toMatch(/^\/html\/body\[1\]\/button\[1\]$/);
  });

  it("uses an id-based xpath shortcut when the element has an id", () => {
    const el = mount(document.createElement("div"));
    el.id = "main-nav";
    const { operator } = captureElement(el);
    expect(operator).toBe('//*[@id="main-nav"]');
  });

  it("uses the nearest ancestor id when a descendant is clicked", () => {
    const parent = mount(document.createElement("nav"));
    parent.id = "site-nav";
    const child = document.createElement("a");
    parent.appendChild(child);
    const { operator } = captureElement(child);
    expect(operator).toContain('//*[@id="site-nav"]');
  });

  it("correctly indexes same-tag siblings (1-based)", () => {
    const ul = mount(document.createElement("ul"));
    const li1 = document.createElement("li");
    const li2 = document.createElement("li");
    const li3 = document.createElement("li");
    ul.appendChild(li1);
    ul.appendChild(li2);
    ul.appendChild(li3);
    expect(captureElement(li1).operator).toContain("li[1]");
    expect(captureElement(li2).operator).toContain("li[2]");
    expect(captureElement(li3).operator).toContain("li[3]");
  });

  it("captures and trims element text content", () => {
    const el = mount(document.createElement("span"));
    el.textContent = "  Submit  ";
    expect(captureElement(el).elementText).toBe("Submit");
  });

  it("truncates text content to 120 characters", () => {
    const el = mount(document.createElement("p"));
    el.textContent = "x".repeat(200);
    expect(captureElement(el).elementText.length).toBe(120);
  });

  it("returns an empty string for elements with no text content", () => {
    const el = mount(document.createElement("div"));
    expect(captureElement(el).elementText).toBe("");
  });

  it("escapes double quotes in element ids", () => {
    const el = mount(document.createElement("div"));
    el.id = 'say "hello"';
    const { operator } = captureElement(el);
    expect(operator).toBe('//*[@id="say \\"hello\\""]');
  });
});
