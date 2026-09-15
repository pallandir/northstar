import { afterEach, describe, expect, it } from "vitest";
import { buildSelector, filteredClasses } from "./selector.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardowns.splice(0)) fn();
});

function mount<T extends Element>(el: T): T {
  document.body.appendChild(el);
  teardowns.push(() => document.body.contains(el) && document.body.removeChild(el));
  return el;
}

describe("buildSelector", () => {
  it("prefers a data-testid hook", () => {
    const el = mount(document.createElement("button"));
    el.setAttribute("data-testid", "save-button");
    el.className = "css-a1b2c3";
    expect(buildSelector(el)).toBe('[data-testid="save-button"]');
  });

  it("prefers a stable id over a class chain", () => {
    const el = mount(document.createElement("div"));
    el.id = "traffic-sources";
    expect(buildSelector(el)).toBe("#traffic-sources");
  });

  it("skips a generated id and falls back to a scoped class selector", () => {
    const parent = mount(document.createElement("section"));
    parent.id = "dashboard";
    const child = document.createElement("article");
    child.id = "_a1b2c3d4";
    child.className = "card highlighted";
    parent.appendChild(child);
    expect(buildSelector(child)).toBe("#dashboard article.card.highlighted");
  });

  it("falls back to nth-of-type when siblings share tag and classes", () => {
    const parent = mount(document.createElement("ul"));
    parent.id = "list";
    const li1 = document.createElement("li");
    li1.className = "row";
    const li2 = document.createElement("li");
    li2.className = "row";
    parent.append(li1, li2);
    expect(buildSelector(li2)).toBe("#list li.row:nth-of-type(2)");
  });

  it("falls back to a bare tag selector when it is already unique on the page", () => {
    const el = mount(document.createElement("div"));
    expect(buildSelector(el)).toBe("div");
  });
});

describe("filteredClasses", () => {
  it("drops css-module and emotion style hashed classes", () => {
    const el = document.createElement("div");
    el.className = "card css-1a2b3c sc-bdVaJa emotion-x9y8z7 real-class";
    expect(filteredClasses(el)).toEqual(["card", "real-class"]);
  });
});
