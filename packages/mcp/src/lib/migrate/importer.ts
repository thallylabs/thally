import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import matter from 'gray-matter'
import Anthropic from '@anthropic-ai/sdk'
import type { DocFile } from './github.js'

export interface ImportedPage {
  pageId: string
  frontmatter: { title: string; description: string; keywords: string[] }
  body: string
}

function titleFromFilename(relPath: string): string {
  const filename = relPath.replace(/\\/g, '/').split('/').pop() ?? relPath
  const base = basename(filename, extname(filename))
  return base
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function extractFirstParagraph(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('```') || trimmed.startsWith(':::') || trimmed.startsWith('<')) continue
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) continue
    return trimmed.slice(0, 200)
  }
  return ''
}

// ---------------------------------------------------------------------------
// Mintlify component → Dox conversion
// Covers all ~35 Mintlify MDX components documented at mintlify.com/docs
// ---------------------------------------------------------------------------

function normalizeComponents(body: string): string {
  let result = body

  // ── 1. Strip MDX import statements ──────────────────────────────────────────
  const importedComponents = new Set<string>()
  result = result.replace(
    /^import\s+(\w+|\{[^}]+\})\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm,
    (_, imported: string) => {
      const name = imported.trim()
      if (/^[A-Z]\w*$/.test(name)) importedComponents.add(name)
      return ''
    },
  )
  for (const name of importedComponents) {
    result = result.replace(
      new RegExp(`<${name}(?:\\s[^>]*)?\\/>`,'gm'),
      `{/* <${name} /> — imported snippet component */}`,
    )
    result = result.replace(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'g'),
      `{/* <${name}> — imported snippet component */}`,
    )
  }

  // ── 2. HTML comments → MDX comments (MDX can't parse <!-- -->) ────────────
  result = result.replace(/<!--([\s\S]*?)-->/g, (_, inner) => `{/*${inner}*/}`)

  // ── 3. Mintlify callouts ──────────────────────────────────────────────────
  // Note / Warning / Info / Error → already valid Dox component names, no change needed.
  result = result.replace(/<Tip>([\s\S]*?)<\/Tip>/g, (_, c) => `<Note>${c}</Note>`)
  result = result.replace(/<Check>([\s\S]*?)<\/Check>/g, (_, c) => `<Note>${c}</Note>`)
  result = result.replace(/<Danger>([\s\S]*?)<\/Danger>/g, (_, c) => `<Error>${c}</Error>`)
  result = result.replace(/<Callout(?:\s[^>]*)?>([\s\S]*?)<\/Callout>/g, (_, c) => `<Note>${c}</Note>`)

  // ── 4. Docusaurus admonitions: :::type ... ::: → Dox callout components ───
  result = result.replace(/:::(\w+)(?:\s+[^\n]*)?\n([\s\S]*?):::/g, (_, type, content) => {
    const tag = mapAdmonitionToDoxTag(type.toLowerCase())
    return `<${tag}>\n${content.trim()}\n</${tag}>`
  })

  // ── 5. GitBook {% hint style="..." %} → Dox callout components ───────────
  result = result.replace(
    /\{%\s*hint\s+style="(\w+)"\s*%\}([\s\S]*?)\{%\s*endhint\s*%\}/g,
    (_, style, content) => {
      const tag = mapGitBookStyleToDoxTag(style.toLowerCase())
      return `<${tag}>\n${content.trim()}\n</${tag}>`
    },
  )

  // ── 6. AccordionGroup → passthrough (strip wrapper, keep children) ────────
  result = result.replace(/<AccordionGroup[^>]*>\n?([\s\S]*?)\n?<\/AccordionGroup>/g, (_, inner) => inner.trim())

  // ── 7. <Expandable title="..."> → <Accordion title="..."> ────────────────
  result = result.replace(/<Expandable(\s[^>]*)?>/g, (_, attrs = '') => {
    const title = (attrs as string).match(/title="([^"]*)"/)?.[1] ?? 'Details'
    return `<Accordion title="${title}">`
  })
  result = result.replace(/<\/Expandable>/g, '</Accordion>')

  // ── 8. <Latex> → inline code (no LaTeX renderer in Dox) ──────────────────
  result = result.replace(/<Latex>([\s\S]*?)<\/Latex>/g, (_, inner) => `\`${inner.trim()}\``)

  // ── 9. <ResponseField> / <ParamField> → Markdown property definitions ─────
  result = result.replace(/<(?:ResponseField|ParamField)([^>]*)>/g, (_, attrs: string) => {
    const name = attrs.match(/name="([^"]*)"/)?.[1] ?? ''
    const type = attrs.match(/type="([^"]*)"/)?.[1] ?? ''
    const required = /\brequired\b/.test(attrs)
    const def = attrs.match(/default="([^"]*)"/)?.[1]
    const deprecated = /\bdeprecated\b/.test(attrs)
    const meta = [
      type && `\`${type}\``,
      required && '*(required)*',
      deprecated && '*(deprecated)*',
      def !== undefined && `*(default: \`${def}\`)*`,
    ].filter(Boolean).join(' ')
    return `\n**\`${name}\`** ${meta}\n\n`
  })
  result = result.replace(/<\/(?:ResponseField|ParamField)>/g, '\n')

  // ── 10. <RequestExample> / <ResponseExample> → <CodeGroup> ───────────────
  result = result.replace(/<RequestExample[^>]*>/g, '<CodeGroup>')
  result = result.replace(/<\/RequestExample>/g, '</CodeGroup>')
  result = result.replace(/<ResponseExample[^>]*>/g, '<CodeGroup>')
  result = result.replace(/<\/ResponseExample>/g, '</CodeGroup>')

  // ── 11. <Panel> → strip wrapper ──────────────────────────────────────────
  result = result.replace(/<Panel[^>]*>([\s\S]*?)<\/Panel>/g, (_, inner) => inner.trim())

  // ── 12. <Badge> → inline bold text ───────────────────────────────────────
  result = result.replace(/<Badge[^>]*>([\s\S]*?)<\/Badge>/g, (_, inner) => `**${inner.trim()}**`)

  // ── 13. <Tile> → <Card> ──────────────────────────────────────────────────
  result = result.replace(/<Tile(\s[^>]*)?>/g, (_, attrs = '') => `<Card${attrs as string}>`)
  result = result.replace(/<\/Tile>/g, '</Card>')

  // ── 14. <View title="..."> → <Tab title="..."> ───────────────────────────
  result = result.replace(/<View(\s[^>]*)?>/g, (_, attrs = '') => {
    const title = (attrs as string).match(/title="([^"]*)"/)?.[1] ?? 'View'
    return `<Tab title="${title}">`
  })
  result = result.replace(/<\/View>/g, '</Tab>')

  // ── 15. <Update label="..." description="..."> → ## heading ──────────────
  result = result.replace(/<Update(\s[^>]*)?>/g, (_, attrs = '') => {
    const label = (attrs as string).match(/label="([^"]*)"/)?.[1] ?? ''
    const desc = (attrs as string).match(/description="([^"]*)"/)?.[1] ?? ''
    return `## ${label}${desc ? `\n\n*${desc}*` : ''}\n\n`
  })
  result = result.replace(/<\/Update>/g, '\n')

  // ── 16. <Prompt> → fenced code block ─────────────────────────────────────
  result = result.replace(/<Prompt[^>]*>([\s\S]*?)<\/Prompt>/g, (_, inner) => {
    return `\`\`\`text\n${inner.trim()}\n\`\`\``
  })

  // ── 17. <Tree> / <Tree.Folder> / <Tree.File> → fenced text block ─────────
  result = result.replace(/<Tree[^>]*>/g, '```\n')
  result = result.replace(/<\/Tree>/g, '\n```')
  result = result.replace(/<Tree\.Folder[^>]*name="([^"]*)"[^>]*>/g, (_, name: string) => `📁 ${name}/\n`)
  result = result.replace(/<\/Tree\.Folder>/g, '')
  result = result.replace(new RegExp('<Tree\\.File[^>]*name="([^"]*)"[^>]*/>', 'g'), (_, name: string) => `  ${name}\n`)

  // ── 18. <Color> palette → Markdown table ─────────────────────────────────
  result = result.replace(/<Color[^>]*>/g, '| Name | Value |\n|---|---|\n')
  result = result.replace(/<\/Color>/g, '')
  result = result.replace(/<Color\.Row[^>]*title="([^"]*)"[^>]*>/g, (_, title: string) => `**${title}**\n`)
  result = result.replace(/<\/Color\.Row>/g, '')
  result = result.replace(
    /<Color\.Item[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*\/>/g,
    (_, name: string, value: string) => `| ${name} | \`${value}\` |\n`,
  )

  // ── 19. <Banner> → strip (layout-level site config, not MDX content) ──────
  result = result.replace(/<Banner[^>]*>([\s\S]*?)<\/Banner>/g, '')
  result = result.replace(/<Banner[^>]*\/>/g, '')

  return result
}

function mapAdmonitionToDoxTag(type: string): string {
  if (type === 'warning' || type === 'caution') return 'Warning'
  if (type === 'danger') return 'Error'
  if (type === 'info') return 'Info'
  return 'Note'
}

function mapGitBookStyleToDoxTag(style: string): string {
  if (style === 'warning') return 'Warning'
  if (style === 'danger') return 'Error'
  if (style === 'success') return 'Note'
  return 'Info'
}

const RST_SYSTEM_PROMPT = `You are a documentation converter. Convert the given file content to clean MDX.
Respond with ONLY valid JSON — no prose, no markdown fences:
{
  "frontmatter": { "title": "string", "description": "string", "keywords": ["..."] },
  "body": "string — full MDX body"
}
Rules: preserve code blocks with language hints; convert tables to Markdown; convert callout
boxes to <Note> or <Warning>; preserve heading hierarchy; do not include page title as a heading.`

interface ClaudeResponse {
  frontmatter: { title: string; description: string; keywords: string[] }
  body: string
}

function parseClaudeResponse(text: string): ClaudeResponse {
  try {
    return JSON.parse(text) as ClaudeResponse
  } catch {
    const stripped = text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim()
    return JSON.parse(stripped) as ClaudeResponse
  }
}

export async function importFile(file: DocFile, apiKey?: string): Promise<ImportedPage | null> {
  const ext = file.ext.toLowerCase()

  if (ext === '.md' || ext === '.mdx') {
    const raw = readFileSync(file.absPath, 'utf8')
    const parsed = matter(raw)

    const fmTitle = (parsed.data.title as string | undefined) ?? ''
    const fmDesc = (parsed.data.description as string | undefined) ?? ''
    const fmKeywords = parsed.data.keywords as unknown

    const title = fmTitle || titleFromFilename(file.relPath)
    const description = fmDesc || extractFirstParagraph(parsed.content)
    const keywords = Array.isArray(fmKeywords) ? (fmKeywords as string[]) : []

    // Detect Mintlify OpenAPI pages (openapi: "METHOD /path" in frontmatter, empty body)
    // Skip them — the OpenAPI spec file is copied and wired up separately in docs.json
    const openapi = parsed.data.openapi as string | undefined
    const body = normalizeComponents(parsed.content)
    if (openapi && !body.trim()) return null

    return { pageId: file.pageId, frontmatter: { title, description, keywords }, body }
  }

  // Non-Markdown: use Claude if API key is available
  if (!apiKey) {
    throw new Error(`Skipping non-Markdown file (no API key): ${file.relPath}`)
  }

  const content = readFileSync(file.absPath, 'utf8')
  const client = new Anthropic({ apiKey })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: RST_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Convert this documentation file to MDX.\n\nFile: ${file.relPath}\n\nContent:\n${content.slice(0, 80_000)}`,
      },
    ],
  })

  const responseText = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')

  const claudeResult = parseClaudeResponse(responseText)
  return {
    pageId: file.pageId,
    frontmatter: claudeResult.frontmatter,
    body: claudeResult.body,
  }
}
