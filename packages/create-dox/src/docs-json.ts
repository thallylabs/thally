import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DocsJsonNavigationGroup {
  group: string
  pages: Array<string | DocsJsonNavigationGroup>
}

export interface DocsJsonTab {
  tab: string
  href?: string
  groups?: Array<DocsJsonNavigationGroup>
  api?: { source: string }
}

export interface DocsJsonConfig {
  tabs: Array<DocsJsonTab>
  ai?: { chat?: boolean }
  /** Admin-dashboard team roster (C1) — git-committed, no database. */
  team?: {
    members?: Array<{ email: string; role: 'owner' | 'editor' | 'viewer' }>
    domains?: Array<{ domain: string; role: 'owner' | 'editor' | 'viewer' }>
  }
  /** Dox Track — product repos whose merged PRs trigger docs-agent PRs (typed for `dox track add`). */
  tracking?: {
    repos?: Array<{
      owner: string
      repo: string
      branch?: string
      paths?: Array<string>
      outputTab?: string
      outputGroup?: string
    }>
  }
}

export function readDocsJson(projectDir: string): DocsJsonConfig {
  const docsPath = join(projectDir, 'docs.json')
  const raw = readFileSync(docsPath, 'utf8')
  return JSON.parse(raw) as DocsJsonConfig
}

export function writeDocsJson(projectDir: string, config: DocsJsonConfig): void {
  const docsPath = join(projectDir, 'docs.json')
  writeFileSync(docsPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

/**
 * Dox Track is OPT-IN. `docs.json` is copied verbatim into a scaffold (unlike
 * `/cli/`, `/packages/`, and the Track/agent workflows, which are excluded at
 * download time), so the Dox project's own `tracking` block — which watches
 * `kenny-io/Dox` — would otherwise become the default for every new site,
 * silently pointing the user's docs agent at our repo. We strip it here so a
 * fresh scaffold starts with ZERO tracked repos.
 *
 * A user opts in afterwards with `dox track add <owner/repo>` (writes a fresh
 * `tracking` block), then `dox track setup` to wire a trigger. See the Dox Track
 * guide.
 */
export function resetTrackingConfig(projectDir: string): void {
  const config = readDocsJson(projectDir)
  if (config.tracking) {
    delete config.tracking
    writeDocsJson(projectDir, config)
  }
}

/**
 * Opt-IN entry point used when the user says yes to Dox Track during
 * `create-dox`. Writes a fresh `tracking` block for the repos they named
 * (branch `main`, all files) — a starting point they refine in docs.json or with
 * `dox track add`. No-op for an empty list.
 */
export function writeTrackingConfig(
  projectDir: string,
  repos: Array<{ owner: string; repo: string }>,
): void {
  if (repos.length === 0) return
  const config = readDocsJson(projectDir)
  config.tracking = { repos: repos.map((r) => ({ owner: r.owner, repo: r.repo, branch: 'main' })) }
  writeDocsJson(projectDir, config)
}
