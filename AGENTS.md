# Thally public repository instructions

## Repository role

`thallylabs/thally` is the only authored source for the open-source runtime,
cloud-bridge contract, and public packages. `thallylabs/starter` is the complete
customer-ready snapshot generated from one exact runtime commit.
`thallylabs/thally-cloud` is the private control plane and managed-service
implementation.

The sole production architecture authority is
[`thally-cloud/ARCHITECTURE.md`](https://github.com/thallylabs/thally-cloud/blob/main/ARCHITECTURE.md).
That repository is private; maintainers without access should treat this file
and `README.md` as public-boundary guidance, not as a second full-platform
architecture.

## Ownership boundaries

- Author runtime, rendering, structured content, search, machine projections,
  the bridge interface, and public CLI/MCP/agent packages here.
- Never import the private `thally-cloud/src/cloud` implementation. Public code
  reaches managed services only through `src/lib/cloud-bridge` and must handle
  the service being absent.
- Do not hand-apply runtime changes in `thallylabs/starter`. The synchronization
  workflow generates the runtime-owned snapshot and proves byte parity.
- Customer-owned paths include `src/content/`, `docs.json`, `src/data/site.ts`,
  `src/mdx/custom-components.tsx`, `snippets/`, `public/`, and API
  specifications. Runtime upgrades must preserve them.
- A package version, scaffold release, managed site release, and Cloud platform
  release are different artifacts. Do not imply that publishing one upgrades
  the others.

## Change placement and validation

Trace the real entrypoint to the artifact it creates before editing. Public
runtime and package work belongs here; starter-owned seed content belongs in
`starter`; paid service internals belong in `thally-cloud`. A paid feature with
a public surface may require a bridge-contract change here and a private
implementation in Cloud.

Match validation to risk. Runtime, shared-contract, routing, dependency, or
build changes require the relevant full suites and a generated-starter parity
check. Documentation-only corrections require focused formatting, link, and
content checks. Pull requests target `main` directly.

Do not create another architecture document. Update the canonical Cloud
architecture in the same change whenever a production boundary or lifecycle
changes.
