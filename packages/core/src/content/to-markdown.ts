/**
 * Convert an MDX body to clean, agent-friendly GitHub-flavored Markdown.
 *
 * Machine consumers (RAG pipelines, strict Markdown parsers) that ask for
 * `text/markdown` should get real Markdown, not MDX with JSX component tags
 * (`<Steps>`, `<Card>`, `<Note>`) mixed into the prose. This strips the JSX
 * wrappers while keeping their inner content, promotes title-bearing components
 * to headings, and turns callouts into blockquotes.
 *
 * Crucially it never touches anything inside fenced or inline code, so pages
 * that *document* these components (Component Showcase, Callouts, Card &
 * CardGroup) keep their `<Card>` / `` `<Note>` `` examples intact.
 *
 * This is a body transformer — it does not add or remove frontmatter.
 */

import { projectMdxAudience, type ContentAudience } from './audience.js'

function getAttr(tag: string, ...names: Array<string>): string | null {
  for (const name of names) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))
    if (match) return match[1] ?? match[2] ?? ''
  }
  return null
}

const CALLOUTS = ['Note', 'Warning', 'Tip', 'Info', 'Check', 'Danger'] as const

export function mdxToMarkdown(body: string, audience: ContentAudience = 'agents'): string {
  // 1. Stash code so nothing inside it is transformed. Fenced blocks first,
  //    then inline spans. The \x00 sentinel can't occur in source, so restoring
  //    it can't collide with real prose (a bare ` 1 ` placeholder could).
  const guards: Array<string> = []
  const stash = (s: string): string => `\x00${guards.push(s) - 1}\x00`
  let out = projectMdxAudience(body, audience)
    .replace(/```[\s\S]*?```/g, stash) // fenced code blocks
    .replace(/(?<!`)`[^`\n]+`(?!`)/g, stash) // inline code

  // 2. Promote title-bearing components to headings (before the generic strip,
  //    or their titles would be discarded).
  out = out.replace(/<(?:Step|Tab|Accordion|Expandable)\b[^>]*>/g, (tag) => {
    const title = getAttr(tag, 'title')
    return title ? `\n#### ${title}\n` : ''
  })
  out = out.replace(/<Card\b[^>]*>/g, (tag) => {
    const title = getAttr(tag, 'title')
    if (!title) return ''
    const href = getAttr(tag, 'href')
    return `\n#### ${href ? `[${title}](${href})` : title}\n`
  })
  out = out.replace(/<(?:GitHub|Github)\b[^>]*\/?\s*>/g, (tag) => {
    const repo = getAttr(tag, 'repo')
    if (!repo || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(repo)) return ''
    const title = getAttr(tag, 'title') || repo
    return `\n#### [${title}](https://github.com/${repo})\n`
  })

  // 3. Callouts → a labelled blockquote line; the body follows as prose.
  out = out.replace(new RegExp(`<(${CALLOUTS.join('|')})\\b[^>]*>`, 'g'), (_m, name) => `\n> **${name}:** `)

  // 4. API field components → a list item carrying the name and type.
  out = out.replace(/<(?:ParamField|ResponseField)\b[^>]*>/g, (tag) => {
    const name = getAttr(tag, 'path', 'query', 'body', 'name', 'header')
    if (!name) return ''
    const type = getAttr(tag, 'type')
    return `\n- **${name}**${type ? ` (${type})` : ''}: `
  })

  // 5. Strip every remaining JSX component tag (open / close / self-closing),
  //    keeping inner content. Component names start uppercase; real HTML and
  //    Markdown are lowercase, so this leaves genuine markup untouched.
  out = out.replace(/<\/?[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*\b[^>]*>/g, '')

  // 6. Restore code, then collapse the blank lines the strips left behind.
  out = out.replace(/\x00(\d+)\x00/g, (_m, index) => guards[Number(index)])
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}
