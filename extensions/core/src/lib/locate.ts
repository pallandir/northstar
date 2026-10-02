import type {
  ComponentInfo,
  Intent,
  LocateHint,
  Operation,
  PageInfo,
  RouteInfo,
  SemanticInfo,
  SourceLocation,
  Target,
} from "../types.js";

const LANDMARK_ROLES: Record<string, string> = {
  header: "banner",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  footer: "contentinfo",
  form: "form",
  section: "region",
};

function clip(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function accessibleName(el: Element): string | null {
  const label = clip(el.getAttribute("aria-label"), 200);
  if (label) return label;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    const named = clip(text, 200);
    if (named) return named;
  }
  const alt = clip(el.getAttribute("alt") ?? el.getAttribute("title"), 200);
  if (alt) return alt;
  return clip(el.textContent, 120);
}

function landmarkOf(el: Element): string | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const explicit = node.getAttribute("role");
    const role = explicit ?? LANDMARK_ROLES[node.tagName.toLowerCase()];
    if (!role || !Object.values(LANDMARK_ROLES).includes(role)) continue;
    const name = clip(node.getAttribute("aria-label"), 80);
    return name ? `${role} "${name}"` : role;
  }
  return null;
}

function headingOf(el: Element): string | null {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth += 1) {
    let sibling: Element | null = node.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName)) return clip(sibling.textContent, 120);
      const nested = sibling.querySelector("h1, h2, h3, h4, h5, h6");
      if (nested) return clip(nested.textContent, 120);
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
  }
  return null;
}

export function captureSemantics(el: Element, target: Target): SemanticInfo {
  return {
    ariaRole: target.role,
    ariaName: accessibleName(el),
    landmark: landmarkOf(el),
    heading: headingOf(el),
  };
}

export function capturePage(): PageInfo {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  return { title: clip(document.title, 200), colorScheme: dark ? "dark" : "light" };
}

export function deriveIntent(operation: Operation): Intent {
  if (operation.type === "style") return "style";
  if (operation.type === "text") return "copy";
  return "change";
}

interface LocateInput {
  source: SourceLocation | null;
  component: ComponentInfo | null;
  route: RouteInfo | null;
  target: Target;
  semantics: SemanticInfo;
  elementText: string;
}

export function buildLocate(input: LocateInput): LocateHint[] {
  const { source, component, route, target, semantics, elementText } = input;
  const hints: LocateHint[] = [];
  if (source) {
    hints.push({
      kind: "source",
      value: `${source.path}:${source.line}:${source.column}`,
      confidence:
        source.via.startsWith("react-fiber") || source.via.includes("inspector") ? 1 : 0.7,
    });
  }
  const frames = component?.stack.slice(0, 3).map((frame) => frame.name) ?? [];
  if (frames.length > 0) {
    hints.push({ kind: "component", value: frames.join(" < "), confidence: 0.8 });
  }
  if (route?.routeFile) {
    hints.push({
      kind: "routeFile",
      value: route.routeFile,
      confidence: route.confidence === "exact" ? 0.9 : 0.4,
    });
  }
  if (target.testId) hints.push({ kind: "testId", value: target.testId, confidence: 0.95 });
  if (semantics.ariaRole && semantics.ariaName) {
    hints.push({
      kind: "aria",
      value: `${semantics.ariaRole} "${semantics.ariaName}"`,
      confidence: 0.6,
    });
  }
  const text = clip(target.ownText || elementText, 120);
  if (text) hints.push({ kind: "text", value: text, confidence: 0.5 });
  if (target.selector) hints.push({ kind: "selector", value: target.selector, confidence: 0.4 });
  return hints;
}
