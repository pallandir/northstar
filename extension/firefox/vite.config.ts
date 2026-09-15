import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crx } from "@crxjs/vite-plugin";
import { type Plugin, defineConfig } from "vite";
import manifest from "./manifest.config.js";

const isFirefox = process.env.NORTHSTAR_TARGET === "firefox";
const outDir = isFirefox ? "dist-firefox" : "dist";

// CRXJS emits Chrome-only shapes into the generated manifest. Gecko rejects `use_dynamic_url` and
// requires `matches` on every web-accessible resource, so the built file is corrected in place.
function geckoManifest(): Plugin {
  return {
    name: "northstar-gecko-manifest",
    apply: "build",
    closeBundle() {
      if (!isFirefox) return;
      const path = resolve(outDir, "manifest.json");
      const built = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const worker = (built.background as { service_worker?: string } | undefined)?.service_worker;
      if (worker) built.background = { scripts: [worker], type: "module" };
      const resources = built.web_accessible_resources as
        | Array<Record<string, unknown>>
        | undefined;
      if (resources) {
        built.web_accessible_resources = resources.map(({ use_dynamic_url, ...rest }) => ({
          ...rest,
          matches: rest.matches ?? ["<all_urls>"],
        }));
      }
      writeFileSync(path, JSON.stringify(built, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [crx({ manifest }), geckoManifest()],
  build: { outDir },
  server: { port: 5173 },
});
