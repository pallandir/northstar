import type { Rect, Target, TargetAncestor } from "../types.js";
import { buildSelector, filteredClasses } from "./selector.js";

const MAX_OUTER_HTML = 600;
const MAX_ANCESTORS = 6;
const ATTRIBUTE_ALLOWLIST = ["name", "type", "href", "alt", "placeholder", "value", "title"];

export function captureElement(el: Element): { operator: string; elementText: string } {
  return {
    operator: buildXPath(el),
    elementText: (el.textContent ?? "").trim().slice(0, 120),
  };
}

export function captureTarget(el: Element, rect: Rect): Target {
  const selector = buildSelector(el) || buildXPath(el);
  return {
    selector,
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    testId: testId(el),
    role: el.getAttribute("role") || implicitRole(el),
    ariaLabel: el.getAttribute("aria-label"),
    classes: filteredClasses(el),
    attributes: collectAttributes(el),
    ownText: ownText(el),
    ancestors: ancestorChain(el),
    rect,
    outerHtml: outerHtmlExcerpt(el),
  };
}

function testId(el: Element): string | null {
  for (const attr of ["data-testid", "data-test-id", "data-test", "data-cy"]) {
    const value = el.getAttribute(attr);
    if (value) return value;
  }
  return null;
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "input") return (el as HTMLInputElement).type === "checkbox" ? "checkbox" : "textbox";
  return null;
}

function collectAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of ATTRIBUTE_ALLOWLIST) {
    const value = el.getAttribute(name);
    if (value) attrs[name] = value.slice(0, 200);
  }
  return attrs;
}

// The element's own text, distinct from the concatenated text of every descendant, so a card with
// one label and forty rows of data does not drown the label the user actually pointed at.
function ownText(el: Element): string {
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
  }
  return text.trim().slice(0, 200);
}

function ancestorChain(el: Element): TargetAncestor[] {
  const chain: TargetAncestor[] = [];
  let node = el.parentElement;
  while (node && node !== document.documentElement && chain.length < MAX_ANCESTORS) {
    chain.push({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: filteredClasses(node),
    });
    node = node.parentElement;
  }
  return chain;
}

function outerHtmlExcerpt(el: Element): string {
  const html = el.outerHTML;
  return html.length > MAX_OUTER_HTML ? `${html.slice(0, MAX_OUTER_HTML)}…` : html;
}

function buildXPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    if (node.id) {
      parts.unshift(`//*[@id="${escapeId(node.id)}"]`);
      return parts.join("/");
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${sameTagIndex(node)}]`);
    node = node.parentElement;
  }
  if (node === document.documentElement) {
    parts.unshift("html");
  }
  return `/${parts.join("/")}`;
}

function sameTagIndex(el: Element): number {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function escapeId(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
