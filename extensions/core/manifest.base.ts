export const version = "2.0.0";

// The only hosts the extension may talk to over the network: the loopback listener owned by the
// local MCP server. Nothing here grants access to any web page.
const LOOPBACK_HOSTS = ["http://localhost/*", "http://127.0.0.1/*", "http://*.localhost/*"];

export const icons = {
  "16": "icon-16.png",
  "32": "icon-32.png",
  "48": "icon-48.png",
  "128": "icon-128.png",
};

export const base = {
  manifest_version: 3,
  name: "Northstar",
  version,
  description:
    "Leave real-time comments on any interface and route them to your local AI coding assistant.",
  homepage_url: "https://github.com/pallandir/northstar",
  // Page access comes solely from activeTab, granted per tab when the user clicks the toolbar
  // action and gone on navigation. scripting lets the worker inject the overlay into that one tab,
  // and inject the main-world targeting probe alongside it.
  permissions: ["activeTab", "scripting", "storage", "unlimitedStorage"],
  host_permissions: LOOPBACK_HOSTS,
  icons,
  // Declared as a service worker for both targets so CRXJS emits its loader chunk. Firefox MV3
  // has no extension service worker, so the Gecko build rewrites this to an event page.
  background: { service_worker: "src/background.ts", type: "module" },
  action: {
    default_title: "Northstar",
    default_popup: "src/popup/popup.html",
    default_icon: icons,
  },
};
