import { z } from 'zod'
import { readDocsJson, writeDocsJson } from '../lib/docs-json.js'

export const addTabSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
  tabName: z.string().describe('Display name for the new tab (e.g. "Guides", "API Reference")'),
  href: z.string().optional().describe('If set, the tab is a redirect link instead of a content tab (e.g. "/changelog")'),
  position: z.enum(['start', 'end']).optional().default('end').describe('Insert the tab at the start or end of the tab bar'),
})

export type AddTabInput = z.infer<typeof addTabSchema>

export async function handleAddTab(input: AddTabInput): Promise<string> {
  const { projectDir, tabName, href, position = 'end' } = input

  const config = readDocsJson(projectDir)

  const existing = config.tabs.find((t) => t.tab === tabName)
  if (existing) {
    throw new Error(`Tab "${tabName}" already exists in docs.json.`)
  }

  const newTab = href
    ? { tab: tabName, href }
    : { tab: tabName, groups: [] }

  if (position === 'start') {
    config.tabs.unshift(newTab)
  } else {
    config.tabs.push(newTab)
  }

  writeDocsJson(projectDir, config)

  const kind = href ? `redirect → ${href}` : 'content tab (empty, ready for pages)'
  return [
    `✅ Tab "${tabName}" added to docs.json`,
    `   kind:     ${kind}`,
    `   position: ${position}`,
    ...(href ? [] : [``, `Next: add pages with add_page using tab: "${tabName}"`]),
  ].join('\n')
}
