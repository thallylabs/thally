import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types (mirrored from src/data/docs.ts)
// ---------------------------------------------------------------------------

export interface DocsJsonNavigationGroup {
  group: string
  pages: Array<string | DocsJsonNavigationGroup>
}

export interface DocsJsonApiConfig {
  source: string
  tagsOrder?: Array<string>
  defaultGroup?: string
  webhookGroup?: string
  overrides?: Record<string, {
    title?: string
    description?: string
    badge?: string
    group?: string
    slug?: Array<string>
    hidden?: boolean
  }>
}

export interface DocsJsonTab {
  tab: string
  href?: string
  groups?: Array<DocsJsonNavigationGroup>
  api?: DocsJsonApiConfig
}

export interface DocsJsonConfig {
  tabs: Array<DocsJsonTab>
  ai?: { chat?: boolean; label?: string; icon?: string }
  i18n?: {
    defaultLocale: string
    locales: Array<{ code: string; label: string }>
  }
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readDocsJson(projectDir: string): DocsJsonConfig {
  const docsPath = join(projectDir, 'docs.json')
  const raw = readFileSync(docsPath, 'utf8')
  return JSON.parse(raw) as DocsJsonConfig
}

export function writeDocsJson(projectDir: string, config: DocsJsonConfig): void {
  const docsPath = join(projectDir, 'docs.json')
  writeFileSync(docsPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}
