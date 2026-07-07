import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ParsedArgs } from '../router.js'

interface DocsJsonGroup {
  group?: string
  pages?: Array<string | DocsJsonGroup>
}

interface DocsJsonTab {
  tab?: string
  href?: string
  api?: unknown
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

export function runNewPage(args: ParsedArgs, cwd = process.cwd()): number {
  const pageId = args.positionals[0]
  if (!pageId) {
    process.stderr.write('\n  Usage: dox new <page-id> [--title "..."] [--description "..."]\n\n')
    return 1
  }

  const docsJsonPath = path.join(cwd, 'docs.json')
  if (!existsSync(docsJsonPath)) {
    process.stderr.write('\n  Not a Dox project: docs.json not found.\n\n')
    return 1
  }

  const normalized = pageId.replace(/\.mdx$/, '').replace(/^\/+/, '')
  const filePath = path.join(cwd, 'src', 'content', `${normalized}.mdx`)
  if (existsSync(filePath)) {
    process.stderr.write(`\n  Page already exists: src/content/${normalized}.mdx\n\n`)
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
    const tab = docs.tabs?.find((t) => !t.href && !t.api && t.groups && t.groups.length > 0)
    const group = tab?.groups?.[tab.groups.length - 1]
    if (group) {
      group.pages = group.pages ?? []
      if (!group.pages.includes(normalized)) group.pages.push(normalized)
      writeFileSync(docsJsonPath, `${JSON.stringify(docs, null, 2)}\n`, 'utf8')
      registered = true
    }
  } catch {
    // leave registered = false; file is still created
  }

  process.stdout.write(`\n  Created src/content/${normalized}.mdx\n`)
  process.stdout.write(
    registered
      ? '  Registered in docs.json navigation.\n\n'
      : '  Note: add it to docs.json navigation manually.\n\n',
  )
  return 0
}
