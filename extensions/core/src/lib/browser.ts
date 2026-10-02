type BrowserApi = typeof chrome;

// Firefox exposes the promise-based namespace as `browser` and keeps `chrome` callback-style,
// so every `await` in this extension has to go through whichever one the host provides.
const api: BrowserApi = (globalThis as { browser?: BrowserApi }).browser ?? chrome;

export const browser = api;
