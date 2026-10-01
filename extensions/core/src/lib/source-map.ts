import type { SourceLocation } from "../types.js";
import { sanitizeSourcePath } from "./sanitize.js";

type Reader = (el: Element) => SourceLocation | null;

const reactInspector: Reader = (el) => {
  const raw = el.getAttribute("data-inspector-relative-path");
  const line = el.getAttribute("data-inspector-line");
  const column = el.getAttribute("data-inspector-column");
  if (!raw || !line) return null;
  const path = sanitizeSourcePath(raw);
  if (!path) return null;
  return { path, line: Number(line), column: Number(column ?? 0), via: "react-dev-inspector" };
};

const vueInspector: Reader = (el) => {
  const raw = el.getAttribute("data-v-inspector");
  if (!raw) return null;
  const [rawPath, line, column] = raw.split(":");
  if (!rawPath || !line) return null;
  const path = sanitizeSourcePath(rawPath);
  if (!path) return null;
  return {
    path,
    line: Number(line),
    column: Number(column ?? 0),
    via: "vite-plugin-vue-inspector",
  };
};

const svelteInspector: Reader = (el) => {
  const raw = el.getAttribute("data-svelte-source") ?? el.getAttribute("data-svelte");
  if (!raw) return null;
  const match = raw.match(/(.+):(\d+):(\d+)/);
  if (!match) return null;
  const path = sanitizeSourcePath(match[1]);
  if (!path) return null;
  return {
    path,
    line: Number(match[2]),
    column: Number(match[3]),
    via: "svelte-inspector",
  };
};

const READERS: Reader[] = [reactInspector, vueInspector, svelteInspector];

export function resolveSource(el: Element): SourceLocation | null {
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    for (const read of READERS) {
      const found = read(node);
      if (found) return found;
    }
    node = node.parentElement;
  }
  return null;
}

const SOURCE_SELECTOR =
  "[data-inspector-relative-path],[data-v-inspector],[data-svelte-source],[data-svelte]";
const MAX_SOURCE_PATHS = 20;

export function collectSourcePaths(root: ParentNode = document): string[] {
  const paths = new Set<string>();
  for (const el of root.querySelectorAll(SOURCE_SELECTOR)) {
    const found = READERS.map((read) => read(el)).find((location) => location !== null);
    if (found) paths.add(found.path);
    if (paths.size >= MAX_SOURCE_PATHS) break;
  }
  return [...paths];
}
