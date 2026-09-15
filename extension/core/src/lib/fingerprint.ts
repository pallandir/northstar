export function captureElement(el: Element): { operator: string; elementText: string } {
  return {
    operator: buildXPath(el),
    elementText: (el.textContent ?? "").trim().slice(0, 120),
  };
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
