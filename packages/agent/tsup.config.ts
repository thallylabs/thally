import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    scaffold: "src/scaffold.ts",
    "write-policy-contract": "src/write-policy-contract.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node18",
  // Resolved at runtime from the dependency tree, not bundled.
  external: [
    "@thallylabs/mcp",
    "playwright",
    "playwright-core",
  ],
  clean: true,
  dts: true,
});
