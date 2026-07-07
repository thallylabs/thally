import { z } from 'zod'
import { readDocsJson } from '../lib/docs-json.js'
import type { DocsJsonNavigationGroup } from '../lib/docs-json.js'

export const listPagesSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
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

export async function handleListPages(input: ListPagesInput): Promise<string> {
  const config = readDocsJson(input.projectDir)
  const lines: string[] = []

  for (const tab of config.tabs) {
    lines.push(`Tab: ${tab.tab}`)

    if (tab.href) {
      lines.push(`  → External: ${tab.href}`)
    } else if (tab.api) {
      lines.push(`  → API Reference: ${tab.api.source}`)
    } else if (tab.groups && tab.groups.length > 0) {
      for (const group of tab.groups) {
        lines.push(...formatGroup(group, '  '))
      }
    } else {
      lines.push('  (no pages)')
    }

    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
