export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["extension", "core", "chromium", "firefox", "mcp", "examples", "root", "deps", "ci", "docs"],
    ],
  },
};
