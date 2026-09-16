import { defineManifest } from "@crxjs/vite-plugin";
import { base } from "../core/manifest.base.js";

export default defineManifest({
  ...base,
  // 128 is the Popover API floor the overlay needs to reach the top layer; storage.session needs
  // only 115, so this is the binding constraint.
  browser_specific_settings: {
    gecko: {
      id: "northstar@pallandir.dev",
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] },
    },
  },
});
