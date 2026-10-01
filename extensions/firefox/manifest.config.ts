import { defineManifest } from "@crxjs/vite-plugin";
import { base } from "../core/manifest.base.js";

export default defineManifest({
  ...base,
  browser_specific_settings: {
    gecko: {
      id: "northstar@pallandir.dev",
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] },
    },
  },
});
