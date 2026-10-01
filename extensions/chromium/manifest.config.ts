import { defineManifest } from "@crxjs/vite-plugin";
import { base } from "../core/manifest.base.js";

export default defineManifest({ ...base, minimum_chrome_version: "114" });
