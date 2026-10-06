/** Create a content page and register it in customer-owned navigation. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { terminal } from 'create-thally-docs/terminal'
import type { ParsedArgs } from '../router.js'

interface DocsJsonGroup {
  group?: string
  pages?: Array<string | DocsJsonGroup>
}

interface DocsJsonTab {
  tab?: string
  href?: string
  api?: unknown
  pages?: Array<string | DocsJsonGroup>
  groups?: Array<DocsJsonGroup>
}

interface DocsJson {
  tabs?: Array<DocsJsonTab>
}

function deriveTitle(pageId: string): string {
  const last = pageId.split('/').pop() ?? pageId
  return last
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Create a page while preserving the existing navigation registration behavior. */
export function runNewPage(args: ParsedArgs, cwd = process.cwd()): number {
  const pageId = args.positionals[0]
  if (!pageId) {
    terminal.error('Usage: thally new <page-id> [--title "..."] [--description "..."]')
    return 1
  }

  const docsJsonPath = path.join(cwd, 'docs.json')
  if (!existsSync(docsJsonPath)) {
    terminal.error('Not a Thally project: docs.json not found.')
    return 1
  }

  const normalized = pageId.replace(/\.mdx$/, '').replace(/^\/+/, '')
  const filePath = path.join(cwd, 'src', 'content', `${normalized}.mdx`)
  if (existsSync(filePath)) {
    terminal.error(`Page already exists: src/content/${normalized}.mdx`)
    return 1
  }

  const title = args.getFlag('--title') ?? deriveTitle(normalized)
  const description = args.getFlag('--description') ?? ''

  mkdirSync(path.dirname(filePath), { recursive: true })
  const frontmatter = [
    '---',
    `title: ${title}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    'Write your content here.',
    '',
  ].join('\n')
  writeFileSync(filePath, frontmatter, 'utf8')

  // Register in the first content tab's last group so the page is discoverable.
  let registered = false
  try {
    const docs = JSON.parse(readFileSync(docsJsonPath, 'utf8')) as DocsJson
    const tab = docs.tabs?.find((candidate) => !candidate.href && !candidate.api
      && (candidate.pages?.length || candidate.groups?.length))
    if (tab?.pages) {
      if (!tab.pages.includes(normalized)) tab.pages.push(normalized)
      writeFileSync(docsJsonPath, `${JSON.stringify(docs, null, 2)}\n`, 'utf8')
      registered = true
    }
    const group = tab?.groups?.[tab.groups.length - 1]
    if (!registered && group) {
      group.pages = group.pages ?? []
      if (!group.pages.includes(normalized)) group.pages.push(normalized)
      writeFileSync(docsJsonPath, `${JSON.stringify(docs, null, 2)}\n`, 'utf8')
      registered = true
    }
  } catch {
    // leave registered = false; file is still created
  }

  terminal.success(`Created src/content/${normalized}.mdx`)
  if (registered) terminal.info('Added to docs.json navigation.')
  else terminal.warn('Add this page to docs.json navigation to make it discoverable.')
  return 0
}
