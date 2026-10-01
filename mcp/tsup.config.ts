import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: [/^@northstar\//],
  banner: {
    js: "#!/usr/bin/env node",
  },
  onSuccess: "node scripts/copy-assets.mjs",
});
