/**
 * Injected into the page's MAIN world with `chrome.scripting.executeScript({ func: installProbe,
 * world: "MAIN" })`. Chrome serializes only this function's own source text, so it cannot close
 * over anything from this module or any other: every constant and helper it needs is declared
 * inside the function body, duplicated by hand from protocol.ts where it names a shared constant.
 * probe-script.test.ts checks the two stay in sync.
 *
 * Reads only. Never assigns to anything on a page object's prototype, never calls back into the
 * page beyond dispatching its own events, and every reader is wrapped so a hostile or merely
 * unusual page can make it return null but never throw into that page's own execution.
 */
export function installProbe(): void {
  const w = window as unknown as { __northstarProbeInstalled?: boolean };
  if (w.__northstarProbeInstalled) return;
  w.__northstarProbeInstalled = true;

  const REQUEST_EVENT = "northstar:probe:request";
  const RESPONSE_EVENT = "northstar:probe:response";
  const NAVIGATE_EVENT = "northstar:navigate";
  const PROBE_ATTR = "data-northstar-probe-id";

  type Frame = { name: string };
  type Source = { path: string; line: number; column: number; via: string };
  type Route = {
    pattern: string;
    params: Record<string, string> | null;
    router: string;
    routeFile: string | null;
    confidence: "exact" | "inferred";
  };
  type Result = {
    component: { stack: Frame[] } | null;
    source: Source | null;
    route: Route | null;
  };

  function safe<T>(fn: () => T | null): T | null {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  // ---------- React ----------

  function reactFiberKey(el: Element): string | undefined {
    return Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
    );
  }

  function reactFiber(el: Element): unknown {
    const key = reactFiberKey(el);
    if (!key) return null;
    return (el as unknown as Record<string, unknown>)[key] ?? null;
  }

  function fiberComponentName(fiber: Record<string, unknown>): string | null {
    const type = fiber.type as unknown;
    if (typeof type === "string") return null; // host element (div, span, ...)
    if (typeof type === "function") {
      return (type as { displayName?: string; name?: string }).displayName ?? type.name ?? null;
    }
    if (type && typeof type === "object") {
      const t = type as { displayName?: string; render?: unknown; type?: unknown };
      if (t.displayName) return t.displayName;
      if (t.render && typeof t.render === "object") {
        const r = t.render as { displayName?: string; name?: string };
        return r.displayName ?? r.name ?? null;
      }
      if (typeof t.render === "function") {
        const r = t.render as unknown as { displayName?: string; name?: string };
        return r.displayName ?? r.name ?? null;
      }
    }
    return null;
  }

  function parseStackFrame(stack: string): Source | null {
    const lines = stack.split("\n");
    for (const line of lines) {
      if (line.includes("node_modules") || line.includes("react-dom")) continue;
      const match = line.match(/(?:\()?((?:https?:|file:)?\/\/?[^\s()]+):(\d+):(\d+)\)?\s*$/);
      if (!match) continue;
      let path = match[1];
      try {
        const url = new URL(path, location.href);
        path = url.pathname.replace(/^\//, "");
      } catch {
        // already a bare path
      }
      if (!path || path.startsWith("node_modules")) continue;
      return { path, line: Number(match[2]), column: Number(match[3]), via: "react-fiber-stack" };
    }
    return null;
  }

  function reactSource(fiber: Record<string, unknown>): Source | null {
    const debugSource = fiber._debugSource as
      | { fileName?: string; lineNumber?: number; columnNumber?: number }
      | undefined;
    if (debugSource?.fileName) {
      return {
        path: debugSource.fileName,
        line: debugSource.lineNumber ?? 0,
        column: debugSource.columnNumber ?? 0,
        via: "react-fiber",
      };
    }
    const debugStack = fiber._debugStack as { stack?: string } | Error | undefined;
    const stackText =
      debugStack instanceof Error ? debugStack.stack : (debugStack as { stack?: string })?.stack;
    if (typeof stackText === "string") {
      const found = parseStackFrame(stackText);
      if (found) return found;
    }
    return null;
  }

  function readReact(el: Element): { component: { stack: Frame[] }; source: Source | null } | null {
    const fiber = reactFiber(el) as Record<string, unknown> | null;
    if (!fiber) return null;

    const stack: Frame[] = [];
    let source: Source | null = null;
    let node: Record<string, unknown> | null = fiber;
    let guard = 0;
    while (node && guard < 40) {
      guard++;
      const name = fiberComponentName(node);
      if (name && (stack.length === 0 || stack[stack.length - 1].name !== name)) {
        stack.push({ name });
      }
      if (!source) source = reactSource(node);
      node = (node.return as Record<string, unknown> | null) ?? null;
      if (stack.length >= 8) break;
    }
    if (stack.length === 0 && !source) return null;
    return { component: { stack }, source };
  }

  // ---------- Vue ----------

  function readVue3(el: Element): { component: { stack: Frame[] }; source: Source | null } | null {
    const instance = (el as unknown as { __vueParentComponent?: unknown }).__vueParentComponent as
      | Record<string, unknown>
      | undefined;
    if (!instance) return null;
    const stack: Frame[] = [];
    let source: Source | null = null;
    let node: Record<string, unknown> | null = instance;
    let guard = 0;
    while (node && guard < 20) {
      guard++;
      const type = node.type as Record<string, unknown> | undefined;
      const name =
        (type?.name as string | undefined) ??
        (type?.__name as string | undefined) ??
        (typeof type?.__file === "string" ? String(type.__file).split(/[\\/]/).pop() : null);
      if (name && (stack.length === 0 || stack[stack.length - 1].name !== name)) {
        stack.push({ name });
      }
      if (!source && typeof type?.__file === "string") {
        source = { path: type.__file, line: 0, column: 0, via: "vue-component-file" };
      }
      node = (node.parent as Record<string, unknown> | null) ?? null;
    }
    if (stack.length === 0 && !source) return null;
    return { component: { stack }, source };
  }

  function readVue2(el: Element): { component: { stack: Frame[] }; source: Source | null } | null {
    const instance = (el as unknown as { __vue__?: unknown }).__vue__ as
      | Record<string, unknown>
      | undefined;
    if (!instance) return null;
    const stack: Frame[] = [];
    let source: Source | null = null;
    let node: Record<string, unknown> | null = instance;
    let guard = 0;
    while (node && guard < 20) {
      guard++;
      const options = node.$options as Record<string, unknown> | undefined;
      const name =
        (options?.name as string | undefined) ??
        (options?._componentTag as string | undefined) ??
        (typeof options?.__file === "string" ? String(options.__file).split(/[\\/]/).pop() : null);
      if (name && (stack.length === 0 || stack[stack.length - 1].name !== name)) {
        stack.push({ name });
      }
      if (!source && typeof options?.__file === "string") {
        source = { path: options.__file, line: 0, column: 0, via: "vue-component-file" };
      }
      node = (node.$parent as Record<string, unknown> | null) ?? null;
    }
    if (stack.length === 0 && !source) return null;
    return { component: { stack }, source };
  }

  // ---------- Svelte ----------

  function readSvelte(
    el: Element,
  ): { component: { stack: Frame[] }; source: Source | null } | null {
    const files: string[] = [];
    let node: Element | null = el;
    let guard = 0;
    let source: Source | null = null;
    while (node && guard < 12) {
      guard++;
      const meta = (node as unknown as { __svelte_meta?: { loc?: Record<string, unknown> } })
        .__svelte_meta;
      const loc = meta?.loc as { file?: string; line?: number; column?: number } | undefined;
      if (loc?.file) {
        if (!source)
          source = {
            path: loc.file,
            line: loc.line ?? 0,
            column: loc.column ?? 0,
            via: "svelte-loc",
          };
        const name = loc.file.split(/[\\/]/).pop() ?? loc.file;
        if (files[files.length - 1] !== name) files.push(name);
      }
      node = node.parentElement;
    }
    if (files.length === 0) return null;
    return { component: { stack: files.map((name) => ({ name })) }, source };
  }

  // ---------- Angular ----------

  function readAngular(
    el: Element,
  ): { component: { stack: Frame[] }; source: Source | null } | null {
    const ng = (window as unknown as { ng?: Record<string, unknown> }).ng;
    const getComponent = ng?.getComponent as ((el: Element) => unknown) | undefined;
    if (typeof getComponent !== "function") return null;
    const instance = getComponent(el);
    if (!instance) return null;
    const ctor = (instance as { constructor?: { name?: string } }).constructor;
    const name = ctor?.name;
    if (!name) return null;
    const cmp = (ctor as unknown as { ɵcmp?: { debugInfo?: { filePath?: string } } })?.ɵcmp;
    const filePath = cmp?.debugInfo?.filePath;
    const source: Source | null = filePath
      ? { path: filePath, line: 0, column: 0, via: "angular-debug-info" }
      : null;
    return { component: { stack: [{ name }] }, source };
  }

  function readComponent(
    el: Element,
  ): { component: { stack: Frame[] }; source: Source | null } | null {
    return (
      safe(() => readReact(el)) ??
      safe(() => readVue3(el)) ??
      safe(() => readVue2(el)) ??
      safe(() => readAngular(el)) ??
      safe(() => readSvelte(el))
    );
  }

  // ---------- Route ----------

  function inferPattern(pathname: string): string {
    const idish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // uuid
    const nanoid = /^[A-Za-z0-9_-]{16,}$/; // long opaque id
    return (
      pathname
        .split("/")
        .map((seg) => {
          if (seg === "") return seg;
          if (/^\d+$/.test(seg)) return ":id";
          if (idish.test(seg)) return ":id";
          if (/^[0-9a-f]{24}$/i.test(seg)) return ":id"; // mongo objectid shape
          if (nanoid.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg)) return ":id";
          return seg;
        })
        .join("/") || "/"
    );
  }

  function nextRoute(): Route | null {
    const data = (window as unknown as { __NEXT_DATA__?: Record<string, unknown> }).__NEXT_DATA__;
    if (!data || typeof data.page !== "string") return null;
    return {
      pattern: data.page,
      params: (data.query as Record<string, string>) ?? null,
      router: "next",
      routeFile: null,
      confidence: "exact",
    };
  }

  function nuxtRoute(): Route | null {
    const nuxt = (window as unknown as { $nuxt?: Record<string, unknown> }).$nuxt;
    const route = nuxt?.$route as
      | { matched?: Array<{ path?: string }>; params?: unknown }
      | undefined;
    const matched = route?.matched?.[0]?.path;
    if (!matched) return null;
    return {
      pattern: matched,
      params: (route?.params as Record<string, string>) ?? null,
      router: "nuxt",
      routeFile: null,
      confidence: "exact",
    };
  }

  function vueRouterRoute(el: Element | null): Route | null {
    let node = el
      ? ((el as unknown as { __vueParentComponent?: unknown }).__vueParentComponent as
          | Record<string, unknown>
          | undefined)
      : undefined;
    let guard = 0;
    while (node && guard < 20) {
      guard++;
      const proxy = node.proxy as Record<string, unknown> | undefined;
      const route = proxy?.$route as
        | { matched?: Array<{ path?: string }>; params?: unknown }
        | undefined;
      const matched = route?.matched?.[route.matched.length - 1]?.path;
      if (matched) {
        return {
          pattern: matched,
          params: (route?.params as Record<string, string>) ?? null,
          router: "vue-router",
          routeFile: null,
          confidence: "exact",
        };
      }
      node = (node.parent as Record<string, unknown> | null) ?? undefined;
    }
    return null;
  }

  function reactRouterRoute(el: Element | null): Route | null {
    let fiber = el ? (reactFiber(el) as Record<string, unknown> | null) : null;
    let guard = 0;
    while (fiber && guard < 60) {
      guard++;
      const type = fiber.type as { displayName?: string; name?: string } | string | undefined;
      const name = typeof type === "object" ? (type?.displayName ?? type?.name) : undefined;
      const memoizedProps = fiber.memoizedProps as Record<string, unknown> | undefined;
      if (
        (name === "Route" || name === "PathRouteProps") &&
        typeof memoizedProps?.path === "string"
      ) {
        return {
          pattern: memoizedProps.path,
          params: null,
          router: "react-router",
          routeFile: null,
          confidence: "exact",
        };
      }
      fiber = (fiber.return as Record<string, unknown> | null) ?? null;
    }
    return null;
  }

  function readRoute(el: Element | null): Route {
    const pathname = location.pathname;
    const exact =
      safe(nextRoute) ??
      safe(nuxtRoute) ??
      safe(() => vueRouterRoute(el)) ??
      safe(() => reactRouterRoute(el));
    if (exact) return exact;

    const svelteHint = document.querySelector(
      "[data-sveltekit-preload-code], [data-sveltekit-preload-data]",
    );
    const router = svelteHint ? "sveltekit" : "unknown";
    return {
      pattern: inferPattern(pathname),
      params: null,
      router,
      routeFile: null,
      confidence: "inferred",
    };
  }

  // ---------- Wiring ----------

  function probe(el: Element | null): Result {
    const componentResult = el ? readComponent(el) : null;
    return {
      component: componentResult?.component ?? null,
      source: componentResult?.source ?? null,
      route: safe(() => readRoute(el)),
    };
  }

  window.addEventListener(REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent).detail as { nonce?: string } | undefined;
    const nonce = detail?.nonce;
    if (!nonce) return;
    let result: Result = { component: null, source: null, route: null };
    try {
      const el = document.querySelector(`[${PROBE_ATTR}="${cssEscape(nonce)}"]`);
      result = probe(el);
    } catch {
      // never throw into the page
    }
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: { nonce, result } }));
  });

  function cssEscape(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function emitNavigate(): void {
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT));
  }

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = function pushState(...args: Parameters<History["pushState"]>) {
    const result = originalPushState(...args);
    emitNavigate();
    return result;
  };
  history.replaceState = function replaceState(...args: Parameters<History["replaceState"]>) {
    const result = originalReplaceState(...args);
    emitNavigate();
    return result;
  };
  window.addEventListener("popstate", emitNavigate);
  window.addEventListener("hashchange", emitNavigate);
}
