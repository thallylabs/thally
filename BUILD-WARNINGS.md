# Build warning register

Thally keeps generated sites on reproducible, audited dependency graphs. A
small number of upstream install and bundle warnings cannot currently be
removed without crossing an incompatible dependency boundary. This register
pins each known warning to the exact dependency chain so new warnings remain
visible during review.

## Accepted upstream warnings

| Warning | Pinned evidence | Why it remains |
| --- | --- | --- |
| Next middleware-file deprecation during `next build` | `next@16.3.0` recognizes `src/middleware.ts` as an Edge middleware | Next 16's replacement `proxy.ts` is fixed to the Node.js runtime, while `@opennextjs/cloudflare@1.20.2` rejects Node middleware. Keep the deployable Edge convention until OpenNext supports Proxy; verify the incompatibility with `npm run build:cloudflare`. |
| `glob@9.3.5` deprecation during install | `@opennextjs/cloudflare@1.20.2` -> `@opennextjs/aws@4.1.0` -> `@node-minify/core@8.0.6` -> `glob@9.3.5` | `@node-minify/core` pins this exact major. Overriding a deprecated transitive dependency across a major version is not a safe application fix. Verify with `npm explain glob`. |
| `tsconfck@3.1.6` deprecation during install | `vite-tsconfig-paths@5.1.4` -> `tsconfck@3.1.6` | The current direct dependency resolves to the newest compatible release. Verify with `npm explain tsconfck`. |
| `node-domexception@1.0.0` deprecation during install | `@libsql/client@0.14.0` -> `@libsql/hrana-client@0.7.0` -> `node-fetch@3.3.2` -> `fetch-blob@3.2.0` -> `node-domexception@1.0.0` | The package is pinned through the current database client rather than application code. OpenNext and SDK tooling also resolve the same deprecated package. Verify every chain with `npm explain node-domexception`. |
| `whatwg-encoding@3.1.1` deprecation during install | `@thallylabs/migrate@0.2.4` -> `cheerio@1.0.0` -> `encoding-sniffer@0.2.1` -> `whatwg-encoding@3.1.1` | The migration package pins Cheerio for its stable server-side conversion contract. Verify with `npm explain whatwg-encoding`. |
| Experimental TypeScript type-stripping warning during `next build` | `next@16.3.0` loads the supported `next.config.ts` configuration | The warning is emitted by Node while Next loads its TypeScript configuration. Converting the user-facing configuration to JavaScript would discard the repository's TypeScript config contract. |
| Duplicate object-key warnings during the OpenNext bundle | `shiki@4.3.0` -> `@shikijs/engine-javascript@4.3.0` -> `oniguruma-to-es@4.3.6` | `oniguruma-to-es@4.3.6` is the newest compatible release. The warnings are produced only after the upstream source's option spreads are transformed by the build pipeline; the source object does not contain duplicate authored keys. |
| Low-severity `esbuild` development-server advisory in workspace tooling | `tsup@8.5.1` -> `esbuild@0.27.7` | `tsup@8.5.1` is current and constrains esbuild to `^0.27.0`; the patched esbuild release is outside that range. The affected development server is not shipped in the generated application. |

## Review policy

Do not add warning-text filters or broad dependency overrides to silence this
list. Re-check each chain when its direct owner is upgraded, remove the entry
when upstream resolves it, and treat any warning not listed here as a
regression. The Cloudflare package also enforces a 29 MiB regression budget,
leaving 3 MiB below the 32 MiB platform limit.
