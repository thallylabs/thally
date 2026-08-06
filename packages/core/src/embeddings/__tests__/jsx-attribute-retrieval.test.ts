import { describe, expect, it } from 'vitest'
import { parseMdxContent } from '../../content/parse'
import { chunkDocument } from '../chunk'
import { embedLocal, localHashProvider } from '../provider'
import { buildEmbeddingIndex } from '../index-store'
import { rankChunks } from '../retrieve'
import type { PageSource } from '../index-store'

// Regression test for AI-answers recall: on real docs pages the only mention
// of a topic often lives in a JSX attribute (e.g. <Card title="Shape the
// navigation">). If attribute prose is dropped during parsing, retrieval has
// no chunk containing the topic word and Ask AI reports the docs don't cover
// it — even though readers can see it on the page.
const customizationPage = `## Make the experience coherent

A reader should recognize the product and understand where to go next without learning a
separate documentation interface.

<CardGroup cols={2}>
  <Card title="Set the identity" icon="sparkles">
    Update the name, description, links, and brand presets in \`src/data/site.ts\`.
  </Card>
  <Card title="Shape the navigation" icon="book-open">
    Organize pages into task-focused tabs and groups in \`docs.json\`.
  </Card>
  <Card title="Choose an icon tone" icon="grid">
    Cards follow your brand accent by default — switch to neutral globally, or override one card like this one.
  </Card>
  <Card title="Add the right formats" icon="link">
    Enable locales, AI features, analytics, or Markdown pages only when they serve readers.
  </Card>
</CardGroup>
`

const quickstartPage = `## Quickstart

Install the package and run the dev server to preview your documentation site locally.
`

const changelogPage = `## Changelog

<Update label="March release" date="2026-03-01">
  Added component previews and faster search indexing.
</Update>
`

function pageSource(pageId: string, title: string, rawBody: string): PageSource {
  const parsed = parseMdxContent(rawBody)
  return {
    pageId,
    href: `/${pageId}`,
    title,
    rawBody,
    chunks: chunkDocument({ pageId, href: `/${pageId}`, title, sections: parsed.sections }),
  }
}

describe('retrieval over JSX attribute prose', () => {
  it('keeps card titles in section text so topic words survive into chunks', () => {
    const parsed = parseMdxContent(customizationPage)
    const coherent = parsed.sections.find((s) => s.id === 'make-the-experience-coherent')
    expect(coherent?.text).toContain('Shape the navigation')
    expect(coherent?.text).toContain('Organize pages into task-focused tabs')
  })

  it('answers "How does navigation work?" with the customization chunk', async () => {
    const sources = [
      pageSource('customization', 'Customize your documentation', customizationPage),
      pageSource('quickstart', 'Quickstart', quickstartPage),
      pageSource('changelog', 'Changelog', changelogPage),
    ]
    const index = await buildEmbeddingIndex({ sources, provider: localHashProvider, noCache: true })
    const ranked = rankChunks(embedLocal('How does navigation work?'), index.chunks, { k: 3 })

    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].chunk.pageId).toBe('customization')
    expect(ranked[0].chunk.text).toContain('navigation')
  })
})

describe('disk cache schema versioning', () => {
  it('discards unversioned caches so parser fixes reach unchanged pages', async () => {
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thally-embed-cache-'))
    const previousCwd = process.cwd()
    process.chdir(dir)
    try {
      const cacheDir = path.join(dir, '.thally', 'embeddings')
      fs.mkdirSync(cacheDir, { recursive: true })
      const source = pageSource('customization', 'Customize your documentation', customizationPage)
      // A pre-fix cache: same rawBody hash, but chunks derived by the old
      // parser (missing attribute prose). Without the version gate this stale
      // entry would be reused forever because rawBody never changed.
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(source.rawBody).digest('hex').slice(0, 16)
      const staleChunk = { ...source.chunks[0], text: 'stale text without the topic word', embedding: [0, 0, 0] }
      fs.writeFileSync(
        path.join(cacheDir, `${localHashProvider.id.replace(/[^a-z0-9._-]/gi, '_')}.json`),
        JSON.stringify({
          provider: localHashProvider.id,
          dimensions: localHashProvider.dimensions,
          pages: { customization: { hash, chunks: [staleChunk] } },
        }),
      )

      const index = (await buildEmbeddingIndex({ sources: [source], provider: localHashProvider })) as Awaited<
        ReturnType<typeof buildEmbeddingIndex>
      > & { reusedPages: number; embeddedPages: number }
      // The unversioned cache must be discarded: the page re-embeds and the
      // stale chunk text never surfaces.
      expect(index.embeddedPages).toBe(1)
      expect(index.reusedPages).toBe(0)
      expect(index.chunks.some((chunk) => chunk.text.includes('stale text'))).toBe(false)
      expect(index.chunks.some((chunk) => chunk.text.includes('Shape the navigation'))).toBe(true)
    } finally {
      process.chdir(previousCwd)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
