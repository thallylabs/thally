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
