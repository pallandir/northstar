// A CSS selector for the agent to jump to the same element in the source, chosen for stability
// rather than uniqueness at any cost: prefer a hook the code deliberately exposes over one that
// merely happens to be there today. A candidate is accepted only once it resolves to exactly this
// element, because a selector that points at nothing, or at something else, is worse than none.

const GENERATED_CLASS =
  /^(css-|sc-|emotion-|jsx-|_[a-zA-Z0-9]{5,8}$|[a-zA-Z0-9]{5,}_[a-zA-Z0-9]{5,}$)/;
const HASH_LIKE_CLASS = /^[a-z]+-[0-9a-f]{5,}$/i;

export function buildSelector(el: Element): string {
  const testId = testIdSelector(el);
  if (testId && isUnique(testId, el)) return testId;

  const idSel = idSelector(el);
  if (idSel && isUnique(idSel, el)) return idSel;

  const scoped = scopedSelector(el);
  if (scoped && isUnique(scoped, el)) return scoped;

  return "";
}

function testIdSelector(el: Element): string | null {
  for (const attr of ["data-testid", "data-test-id", "data-test", "data-cy"]) {
    const value = el.getAttribute(attr);
    if (value) return `[${attr}="${cssEscape(value)}"]`;
  }
  return null;
}

function idSelector(el: Element): string | null {
  if (!el.id || isGeneratedClass(el.id)) return null;
  return `#${cssEscape(el.id)}`;
}

function scopedSelector(el: Element): string | null {
  const own = ownSelector(el);
  const ancestor = nearestStableAncestor(el);
  if (!ancestor) return own;
  const ancestorSelector = testIdSelector(ancestor) ?? idSelector(ancestor);
  if (!ancestorSelector) return own;
  return `${ancestorSelector} ${own}`;
}

function nearestStableAncestor(el: Element): Element | null {
  let node = el.parentElement;
  let depth = 0;
  while (node && depth < 8) {
    if (testIdSelector(node) || idSelector(node)) return node;
    node = node.parentElement;
    depth++;
  }
  return null;
}

function ownSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = filteredClasses(el);
  const withClasses = classes.length > 0 ? `${tag}.${classes.map(cssEscape).join(".")}` : tag;
  if (isUnique(withClasses, el)) return withClasses;

  const parent = el.parentElement;
  if (!parent) return withClasses;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  const index = siblings.indexOf(el) + 1;
  return `${withClasses}:nth-of-type(${index})`;
}

export function filteredClasses(el: Element): string[] {
  return Array.from(el.classList)
    .filter((c) => !isGeneratedClass(c))
    .slice(0, 4);
}

function isGeneratedClass(value: string): boolean {
  return GENERATED_CLASS.test(value) || HASH_LIKE_CLASS.test(value);
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const matches = el.ownerDocument.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
