import { z } from 'zod'
import { readDocsJson } from '../lib/docs-json.js'
import type { DocsJsonNavigationGroup } from '../lib/docs-json.js'

export const listPagesSchema = z.object({
  projectDir: z.string().describe('Path to the Thally project root'),
})

export type ListPagesInput = z.infer<typeof listPagesSchema>

function formatGroup(group: DocsJsonNavigationGroup, indent: string): string[] {
  const lines: string[] = [`${indent}Group: ${group.group}`]
  for (const page of group.pages) {
    if (typeof page === 'string') {
      // Compute href — "introduction" → "/"
      const href = page === 'introduction' ? '/' : `/${page}`
      lines.push(`${indent}  - ${page.padEnd(30)} → ${href}`)
    } else {
      // Nested group
      lines.push(...formatGroup(page, indent + '  '))
    }
  }
  return lines
}

function formatPages(pages: Array<string | DocsJsonNavigationGroup>, indent: string): string[] {
  return pages.flatMap((page) => {
    if (typeof page !== 'string') return formatGroup(page, indent)
    const href = page === 'introduction' ? '/' : `/${page}`
    return [`${indent}- ${page.padEnd(30)} → ${href}`]
  })
}

export async function handleListPages(input: ListPagesInput): Promise<string> {
  const config = readDocsJson(input.projectDir)
  const lines: string[] = []

  for (const tab of config.tabs) {
    lines.push(`Tab: ${tab.tab}`)

    const navigationPages = [...(tab.pages ?? []), ...(tab.groups ?? [])]
    if (tab.href && navigationPages.length === 0) {
      lines.push(`  → External: ${tab.href}`)
    } else if (tab.api && navigationPages.length === 0) {
      lines.push(`  → API Reference: ${tab.api.source}`)
    } else if (navigationPages.length > 0) {
      lines.push(...formatPages(navigationPages, '  '))
    } else {
      lines.push('  (no pages)')
    }

    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
