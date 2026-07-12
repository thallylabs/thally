import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not source: the scaffolded demo and all package build output.
    "demo/**",
    "**/dist/**",
  ]),
  // Engine ↔ cloud boundary (notes/thally-architecture-plan.md §3): engine code
  // must consume cloud-tier services only via @/lib/cloud-bridge, so the OSS
  // build keeps working when src/cloud is reduced to its no-op stub.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/cloud/**", "src/lib/cloud-bridge/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/cloud", "@/cloud/**", "**/cloud/track/**", "**/cloud/ai/**", "**/cloud/analytics/**"],
              message:
                "Engine code must not import src/cloud directly — go through @/lib/cloud-bridge and handle the service being absent.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
