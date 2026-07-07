import { z } from 'zod'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { readDocsJson, writeDocsJson } from '../lib/docs-json.js'
import type { DocsJsonNavigationGroup } from '../lib/docs-json.js'

export const addPageSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
  pageId: z.string().describe('Page identifier (e.g. "guides/auth"). No .mdx extension.'),
  title: z.string().describe('Page title (used in frontmatter)'),
  description: z.string().optional().describe('Page description (used in frontmatter)'),
  content: z.string().optional().describe('MDX body content (placeholder used if omitted)'),
  tab: z.string().optional().describe('Tab name to add the page to (defaults to first tab)'),
  group: z.string().optional().describe('Group name within the tab (defaults to first group)'),
  position: z.enum(['start', 'end']).optional().default('end').describe('Whether to insert at start or end of the group'),
})

export type AddPageInput = z.infer<typeof addPageSchema>

function isString(value: string | DocsJsonNavigationGroup): value is string {
  return typeof value === 'string'
}

export async function handleAddPage(input: AddPageInput): Promise<string> {
  const { projectDir, pageId, title, description, content, position = 'end' } = input

  // Validate pageId: alphanumeric, hyphens, slashes. No .mdx extension.
  if (!/^[a-zA-Z0-9\-/]+$/.test(pageId)) {
    throw new Error(
      `Invalid pageId "${pageId}". Use only alphanumeric characters, hyphens, and slashes. Do not include .mdx extension.`,
    )
  }

  // Compute MDX path
  const mdxPath = join(projectDir, 'src', 'content', `${pageId}.mdx`)

  // Error if file already exists
  if (existsSync(mdxPath)) {
    throw new Error(`Page already exists at: ${mdxPath}`)
  }

  // Create directory if needed
  mkdirSync(dirname(mdxPath), { recursive: true })

  // Build frontmatter
  const frontmatterLines = [`title: ${title}`]
  if (description) {
    frontmatterLines.push(`description: ${description}`)
  }

  const bodyContent = content ?? `## ${title}\n\nAdd your content here.`

  const mdxContent = `---\n${frontmatterLines.join('\n')}\n---\n\n${bodyContent}\n`

  // Write MDX file
  writeFileSync(mdxPath, mdxContent, 'utf8')

  // Update docs.json
  const config = readDocsJson(projectDir)

  // Find or use first tab
  let targetTab = config.tabs[0]
  if (input.tab) {
    const found = config.tabs.find((t) => t.tab === input.tab)
    if (found) {
      targetTab = found
    } else {
      // Create the tab
      const newTab = { tab: input.tab, groups: [] }
      config.tabs.push(newTab)
      targetTab = newTab
    }
  }

  // Ensure the tab has groups
  if (!targetTab.groups) {
    targetTab.groups = []
  }

  // Find or create the group
  const groupName = input.group ?? (targetTab.groups[0]?.group ?? 'General')
  let targetGroup = targetTab.groups.find((g) => g.group === groupName)
  if (!targetGroup) {
    const newGroup: DocsJsonNavigationGroup = { group: groupName, pages: [] }
    targetTab.groups.push(newGroup)
    targetGroup = newGroup
  }

  // Check for duplicate — filter to strings only
  const existingStringPages = targetGroup.pages.filter(isString)
  if (existingStringPages.includes(pageId)) {
    throw new Error(`Page "${pageId}" already exists in group "${groupName}".`)
  }

  // Add the page
  if (position === 'start') {
    targetGroup.pages.unshift(pageId)
  } else {
    targetGroup.pages.push(pageId)
  }

  writeDocsJson(projectDir, config)

  return [
    `✅ Page created: ${mdxPath}`,
    `   pageId:  ${pageId}`,
    `   tab:     ${targetTab.tab}`,
    `   group:   ${groupName}`,
    `   position: ${position}`,
  ].join('\n')
}
