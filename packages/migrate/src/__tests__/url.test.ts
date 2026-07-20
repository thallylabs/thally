/** URL migration fixtures prove path scoping and Markdown-first discovery. */

import { describe, expect, it } from 'vitest'

import { migrateUrl, type MigrationFetcher } from '../index.js'

function response(url: string, body: string, contentType: string) {
  return { finalUrl: new URL(url), body, contentType }
}

describe('public URL migration', () => {
  it('imports only the submitted docs path and prefers llms Markdown pages', async () => {
    const documents = new Map([
      ['https://example.com/docs', response(
        'https://example.com/docs',
        '<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Mintlify documentation home with enough useful text to import.</p></main></body></html>',
        'text/html',
      )],
      ['https://example.com/docs.md', response(
        'https://example.com/docs.md',
        '---\ntitle: Product docs\ndescription: Product documentation.\n---\n\n# Product docs\n\nWelcome to the product documentation. [Install](/docs/guides/install.md#run)',
        'text/markdown',
      )],
      ['https://example.com/llms.txt', response(
        'https://example.com/llms.txt',
        '# Docs\n\n- [Install](https://example.com/docs/guides/install.md)\n- [Blog](https://example.com/blog/launch)',
        'text/plain',
      )],
      ['https://example.com/docs/llms.txt', response(
        'https://example.com/docs/llms.txt',
        '- [API](https://example.com/docs/api/auth.md)',
        'text/plain',
      )],
      ['https://example.com/sitemap.xml', response(
        'https://example.com/sitemap.xml',
        '<urlset><url><loc>https://example.com/docs/guides/install</loc></url><url><loc>https://example.com/pricing</loc></url></urlset>',
        'application/xml',
      )],
      ['https://example.com/docs/sitemap.xml', response(
        'https://example.com/docs/sitemap.xml',
        '<urlset><url><loc>https://example.com/docs/api/auth</loc></url></urlset>',
        'application/xml',
      )],
      ['https://example.com/docs/guides/install.md', response(
        'https://example.com/docs/guides/install.md',
        '---\ntitle: Install\n---\n\n# Install\n\nRun the installer and verify the generated project.',
        'text/markdown',
      )],
      ['https://example.com/docs/api/auth.md', response(
        'https://example.com/docs/api/auth.md',
        '---\ntitle: Authentication\n---\n\n# Authentication\n\nSend a bearer token with every API request.',
        'text/markdown',
      )],
    ])
    const fetcher: MigrationFetcher = async (url) => {
      const document = documents.get(url.toString())
      if (!document) throw new Error(`missing fixture: ${url}`)
      return document
    }

    const bundle = await migrateUrl({
      sourceUrl: 'https://example.com/docs',
      fetcher,
    })

    expect(bundle.pages.map((page) => page.id)).toEqual([
      'introduction',
      'guides/install',
      'api/auth',
    ])
    expect(bundle.pages.some((page) => page.source.includes('/blog/'))).toBe(false)
    expect(bundle.pages[0].body).toContain('[Install](/guides/install#run)')
    expect(bundle.docsConfig.tabs[0].groups?.map((group) => group.group)).toEqual([
      'Overview',
      'Guides',
      'API',
    ])
  })

  it('falls back to rendered HTML when a Markdown endpoint contains site-local code', async () => {
    const fetcher: MigrationFetcher = async (url) => {
      if (url.pathname.endsWith('.md')) {
        return response(
          url.toString(),
          '---\ntitle: Custom home\n---\n\nexport const ProductCard = () => <div>Custom</div>\n\n<ProductCard />',
          'text/markdown',
        )
      }
      if (url.toString() === 'https://custom.example.com/docs') {
        return response(
          url.toString(),
          '<html><head><title>Custom home</title></head><body><main><h1>Custom home</h1><p>The rendered documentation remains portable without repository-local React components.</p><pre><code>&lt;Columns&gt;\n```bash\nnpm install\n```\n&lt;/Columns&gt;</code></pre></main></body></html>',
          'text/html',
        )
      }
      throw new Error('not found')
    }

    const bundle = await migrateUrl({ sourceUrl: 'https://custom.example.com/docs', fetcher })

    expect(bundle.pages[0].body).toContain('The rendered documentation remains portable')
    expect(bundle.pages[0].body).not.toContain('export const ProductCard')
    expect(bundle.pages[0].body).toContain('````\n<Columns>\n```bash')
  })

  it('does not compile active content from an untrusted Markdown endpoint', async () => {
    const fetcher: MigrationFetcher = async (url, request) => {
      if (url.toString() !== 'https://unsafe.example.com/docs') throw new Error('not found')
      if (request.accept.startsWith('text/html')) {
        return response(
          url.toString(),
          '<main><h1>Safe docs</h1><p>Safe rendered documentation content for readers.</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a></main>',
          'text/html',
        )
      }
      return response(
        url.toString(),
        '# Unsafe docs\n\n<script>alert(1)</script>\n\n<a href="javascript:alert(1)">bad</a>',
        'text/markdown',
      )
    }

    const bundle = await migrateUrl({ sourceUrl: 'https://unsafe.example.com/docs', fetcher })

    expect(bundle.pages[0].body).toContain('Safe rendered documentation')
    expect(bundle.pages[0].body).not.toContain('<script')
    expect(bundle.pages[0].body).not.toContain('javascript:')
  })

  it('preserves known documentation components with static props', async () => {
    const fetcher: MigrationFetcher = async (url) => {
      if (url.toString() !== 'https://portable.example.com/docs') throw new Error('not found')
      return response(
        url.toString(),
        '---\ntitle: Portable docs\n---\n\n# Portable docs\n\n<div id="section"><Columns cols={2}><Note title="Heads up">Static component content is portable.</Note></Columns></div>\n\n<Prompt actions={["copy", "cursor"]}>Copy me.</Prompt>\n\n<img src="https://cdn.example.com/image.png" alt="Diagram" onerror="alert(1)" />\n\n[Unsafe link](javascript:alert)\n\n````mdx\n<Card value={{ unsafe: true }} />\n```js\nconst value = { nested: true }\n```\n````',
        'text/markdown',
      )
    }

    const bundle = await migrateUrl({ sourceUrl: 'https://portable.example.com/docs', fetcher })

    expect(bundle.pages[0].body).toContain('<Note title="Heads up">')
    expect(bundle.pages[0].body).toContain('<Columns cols={2}>')
    expect(bundle.pages[0].body).toContain('actions={["copy", "cursor"]}')
    expect(bundle.pages[0].body).toContain('![Diagram](https://cdn.example.com/image.png)')
    expect(bundle.pages[0].body).not.toContain('<div')
    expect(bundle.pages[0].body).not.toContain('javascript:')
  })

  it('maps localized URL roots to Thally locale content directories', async () => {
    const documents = new Map([
      ['https://locale.example.com/docs', response(
        'https://locale.example.com/docs',
        '<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Default language documentation homepage with sufficient content.</p></main></body></html>',
        'text/html',
      )],
      ['https://locale.example.com/docs.md', response(
        'https://locale.example.com/docs.md',
        '---\ntitle: Docs\n---\n\nDefault documentation.',
        'text/markdown',
      )],
      ['https://locale.example.com/llms.txt', response(
        'https://locale.example.com/llms.txt',
        '[Español](https://locale.example.com/docs/es.md)',
        'text/plain',
      )],
      ['https://locale.example.com/docs/es.md', response(
        'https://locale.example.com/docs/es.md',
        '---\ntitle: Documentación\n---\n\nDocumentación en español.',
        'text/markdown',
      )],
    ])
    const fetcher: MigrationFetcher = async (url) => {
      const document = documents.get(url.toString())
      if (!document) throw new Error('not found')
      return document
    }

    const bundle = await migrateUrl({ sourceUrl: 'https://locale.example.com/docs', fetcher })

    expect(bundle.pages.map((page) => page.id)).toEqual(['introduction', 'es/introduction'])
    expect(bundle.docsConfig.i18n?.defaultLocale).toBe('en')
    expect(bundle.docsConfig.i18n?.locales.map((locale) => locale.code)).toEqual(['en', 'es'])
  })
})
