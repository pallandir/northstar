import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import { type Plugin, defineConfig } from "vite";
import manifest from "./manifest.config.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "dist");

// Firefox MV3 has no extension service worker. CRXJS only emits its loader chunk for
// `background.service_worker`, so the manifest declares one and this rewrites the built output to
// a Gecko event page. Gecko also rejects `use_dynamic_url` and requires `matches` on every
// web_accessible_resources entry.
function geckoManifest(): Plugin {
  return {
    name: "northstar-gecko-manifest",
    apply: "build",
    closeBundle() {
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
  root: resolve(here, "../core"),
  plugins: [crx({ manifest }), geckoManifest()],
  // outDir sits outside root, so without emptyOutDir Vite declines to clean it and stale
  // hashed chunks from a previous build would stay in dist/ and get packaged.
  build: { outDir, emptyOutDir: true },
  server: { port: 5174 },
});
