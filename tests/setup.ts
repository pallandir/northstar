const local = new Map<string, unknown>();
const session = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: async (keys?: string | string[]) => {
      const wanted = keys === undefined ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of wanted) if (store.has(key)) out[key] = store.get(key);
      return out;
    },
    set: async (values: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(values)) store.set(k, v);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    clear: async () => store.clear(),
  };
}

Object.assign(globalThis, {
  __northstarStorage: { local, session },
  chrome: {
    storage: { local: area(local), session: area(session) },
    runtime: { id: "test-extension-id", sendMessage: async () => {} },
    scripting: {},
  },
});

const COLOR_DEFAULTS: Record<string, string> = {
  color: "rgb(0, 0, 0)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  borderTopColor: "rgb(0, 0, 0)",
  borderColor: "rgb(0, 0, 0)",
};

if (typeof window !== "undefined") {
  const original = window.getComputedStyle.bind(window);
  const patched = ((el: Element, pseudo?: string | null) => {
    const style = original(el, pseudo);
    return new Proxy(style, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof prop === "string" && value === "" && prop in COLOR_DEFAULTS) {
          return COLOR_DEFAULTS[prop];
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof window.getComputedStyle;
  window.getComputedStyle = patched;
  globalThis.getComputedStyle = patched;
}
