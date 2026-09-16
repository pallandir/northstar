export default {
  sourceDir: "./dist",
  artifactsDir: "./web-ext-artifacts",
  ignoreFiles: ["**/*.map", "**/.DS_Store", "**/.web-extension-id", "**/.amo-upload-uuid"],
  build: {
    overwriteDest: true,
    filename: "northstar-firefox-{version}.zip",
  },
  run: {
    startUrl: ["about:debugging#/runtime/this-firefox"],
  },
  sign: {
    channel: "listed",
    // Listed review is human and slow; submit and exit rather than blocking CI on approval.
    approvalTimeout: 0,
    amoMetadata: "./amo-metadata.json",
    uploadSourceCode: "./web-ext-artifacts/northstar-source.zip",
  },
};
