import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.config.js";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "../core"),
  plugins: [crx({ manifest })],
  // outDir sits outside root, so without emptyOutDir Vite declines to clean it and stale
  // hashed chunks from a previous build would stay in dist/ and get packaged.
  build: { outDir: resolve(here, "dist"), emptyOutDir: true },
  server: { port: 5173 },
});
