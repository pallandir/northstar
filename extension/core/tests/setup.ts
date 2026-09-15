const local = new Map<string, unknown>();
const session = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (values: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(values)) store.set(k, v);
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
