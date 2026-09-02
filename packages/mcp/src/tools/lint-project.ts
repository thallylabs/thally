import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../lib/frontmatter.js'
import { readDocsJson, writeDocsJson } from '../lib/docs-json.js'
import type { DocsJsonNavigationGroup } from '../lib/docs-json.js'
import { scanMdxFiles } from './search-docs.js'

export const lintProjectSchema = z.object({
  projectDir: z.string().describe('Path to the Thally project root'),
  fix: z.boolean().optional().default(false).describe('Auto-fix issues where possible (adds orphan pages to nav)'),
})

export type LintProjectInput = z.infer<typeof lintProjectSchema>

interface LintIssue {
  severity: 'error' | 'warning'
  message: string
  file?: string
}

function collectNavPageIds(groups: Array<string | DocsJsonNavigationGroup>, seen: Set<string>, duplicates: Set<string>): void {
  for (const page of groups) {
    if (typeof page === 'string') {
      if (seen.has(page)) {
        duplicates.add(page)
      } else {
        seen.add(page)
      }
    } else if (page.pages) {
      collectNavPageIds(page.pages, seen, duplicates)
    }
  }
}

function addOrphanToNav(projectDir: string, pageId: string): void {
  const config = readDocsJson(projectDir)
  const tab = config.tabs.find((candidate) => !candidate.href && !candidate.api
    && (candidate.pages?.length || candidate.groups?.length))
  if (!tab) return
  if (tab.pages) {
    if (!tab.pages.includes(pageId)) {
      tab.pages.push(pageId)
      writeDocsJson(projectDir, config)
    }
    return
  }
  if (!tab.groups) return
  const lastGroup = tab.groups[tab.groups.length - 1]
  const existing = lastGroup.pages.filter((p): p is string => typeof p === 'string')
  if (!existing.includes(pageId)) {
    lastGroup.pages.push(pageId)
    writeDocsJson(projectDir, config)
  }
}

export async function handleLintProject(input: LintProjectInput): Promise<string> {
  const { projectDir, fix = false } = input
  const contentDir = join(projectDir, 'src', 'content')
  const issues: LintIssue[] = []

  if (!existsSync(join(projectDir, 'docs.json'))) {
    throw new Error(`Not a Thally project: docs.json not found in ${projectDir}`)
  }

  const config = readDocsJson(projectDir)

  // Collect all nav page IDs + detect duplicates
  const navPageIds = new Set<string>()
  const duplicates = new Set<string>()

  for (const tab of config.tabs) {
    const hasNavigationNodes = Boolean(tab.pages?.length || tab.groups?.length)
    if ((tab.href || tab.api) && !hasNavigationNodes) continue
    if (!hasNavigationNodes) {
      issues.push({ severity: 'error', message: `Tab "${tab.tab}" has no groups and no href — it will render empty` })
      continue
    }
    collectNavPageIds(tab.pages ?? [], navPageIds, duplicates)
    collectNavPageIds(tab.groups ?? [], navPageIds, duplicates)
  }

  for (const dup of duplicates) {
    issues.push({ severity: 'error', message: `[duplicate] "${dup}" appears more than once in docs.json` })
  }

  // Check: page in nav but no MDX file
  for (const pageId of navPageIds) {
    const candidates = [
      join(contentDir, `${pageId}.mdx`),
      join(contentDir, `${pageId}/index.mdx`),
    ]
    if (!candidates.some((c) => existsSync(c))) {
      issues.push({
        severity: 'error',
        message: `"${pageId}" is in docs.json but has no MDX file`,
        file: `src/content/${pageId}.mdx`,
      })
    }
  }

  // Scan all MDX files
  const allFiles: string[] = []
  if (existsSync(contentDir)) {
    scanMdxFiles(contentDir, allFiles)
  }

  const fixedOrphans: string[] = []

  for (const filePath of allFiles) {
    const rel = filePath.slice(contentDir.length + 1).replace(/\.mdx$/, '').replace(/\\/g, '/')
    const pageId = rel.endsWith('/index') ? rel.slice(0, -6) : rel

    // Check: orphan (file not in nav)
    if (!navPageIds.has(pageId)) {
      if (fix) {
        addOrphanToNav(projectDir, pageId)
        fixedOrphans.push(pageId)
      } else {
        issues.push({ severity: 'warning', message: `"${pageId}" is not in docs.json nav (orphan)`, file: filePath.slice(projectDir.length + 1) })
      }
    }

    // Parse frontmatter
    let data: Record<string, unknown> = {}
    let content = ''
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = parseFrontmatter(raw)
      data = parsed.data
      content = parsed.content
    } catch {
      issues.push({ severity: 'error', message: `Could not parse frontmatter`, file: filePath.slice(projectDir.length + 1) })
      continue
    }

    if (!data.title) {
      issues.push({ severity: 'warning', message: `Missing "title" in frontmatter`, file: filePath.slice(projectDir.length + 1) })
    }
    if (!data.description) {
      issues.push({ severity: 'warning', message: `Missing "description" in frontmatter`, file: filePath.slice(projectDir.length + 1) })
    }
    if (content.trim().length < 50) {
      issues.push({ severity: 'warning', message: `Very short body (${content.trim().length} chars) — page may be empty`, file: filePath.slice(projectDir.length + 1) })
    }
  }

  // Build output
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  const lines: string[] = [`Linting ${projectDir}...\n`]

  if (errors.length === 0 && warnings.length === 0 && fixedOrphans.length === 0) {
    lines.push('✅ No issues found.')
    return lines.join('\n')
  }

  lines.push(`❌ ${errors.length} error${errors.length !== 1 ? 's' : ''}, ⚠️  ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}\n`)

  if (errors.length > 0) {
    lines.push('ERRORS:')
    for (const issue of errors) {
      lines.push(`  ${issue.message}`)
      if (issue.file) lines.push(`  → ${issue.file}`)
      lines.push('')
    }
  }

  if (warnings.length > 0) {
    lines.push('WARNINGS:')
    for (const issue of warnings) {
      lines.push(`  ${issue.message}`)
      if (issue.file) lines.push(`  → ${issue.file}`)
      lines.push('')
    }
  }

  if (fixedOrphans.length > 0) {
    lines.push(`✅ Auto-fixed ${fixedOrphans.length} orphan page${fixedOrphans.length > 1 ? 's' : ''} (added to nav):`)
    for (const p of fixedOrphans) lines.push(`  + ${p}`)
    lines.push('')
  }

  if (!fix && warnings.some((w) => w.message.includes('orphan'))) {
    lines.push('Tip: run with fix: true to auto-add orphan pages to navigation.')
  }

  return lines.join('\n').trimEnd()
}
