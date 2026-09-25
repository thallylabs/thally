/** Generated page descriptions contain readable prose, never component syntax. */

import { describe, expect, it } from 'vitest'

import { normalizeMdx, parseMarkdownPage } from '../mdx.js'

function description(raw: string): string | undefined {
  return parseMarkdownPage({ id: 'faq', raw, source: 'https://example.com/faq' })?.description
}

describe('migration description fallback', () => {
  it('extracts the first paragraph inside an accordion without its JSX wrappers', () => {
    expect(description(`---\ntitle: Questions\n---\n\n<Accordion title="Where can I learn more?">\n  See the [API documentation](/api) for details.\n</Accordion>`))
      .toBe('See the API documentation for details.')
  })

  it('skips code examples and expressions while preserving inline prose formatting', () => {
    expect(description(`import Widget from './widget.jsx'\n\n# Questions\n\n<Accordion title="How?">\n\n\`\`\`http\nGET /example\n\`\`\`\n\nUse **settings** with <code>enabled</code> and <a href="/help">the guide</a>.\n</Accordion>`))
      .toBe('Use settings with enabled and the guide.')
  })

  it('preserves authored descriptions exactly', () => {
    expect(description('---\ntitle: Questions\ndescription: "Authored description."\n---\n\nDifferent paragraph.'))
      .toBe('Authored description.')
  })

  it('does not invent description text for code-only pages', () => {
    expect(description('```jsx\n<Widget />\n```')).toBe('')
  })
})

describe('Docusaurus import normalization', () => {
  it('removes injected global component imports', () => {
    expect(normalizeMdx("import Tabs from '@theme/Tabs';\n\n<Tabs />"))
      .toBe('\n<Tabs />')
  })

  it('handles adversarial whitespace in linear time', () => {
    const source = `import${' '.repeat(100_000)}Widget from '@theme/Widget'`
    const startedAt = performance.now()

    expect(normalizeMdx(source)).toBe(source)
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })
})

describe('nested code fence widening', () => {
  it('widens an outer fence so a same-length nested fence does not close it early', () => {
    const source = '```mdx\n<Tabs>\n  <Tab title="npm">\n    ```bash\n    npm install x\n    ```\n  </Tab>\n</Tabs>\n```'
    expect(normalizeMdx(source)).toBe(
      '````mdx\n<Tabs>\n  <Tab title="npm">\n    ```bash\n    npm install x\n    ```\n  </Tab>\n</Tabs>\n````',
    )
  })

  it('widens each ancestor enough for doubly nested fences of the same length', () => {
    const source = '```mdx\n```bash\n```diff\ncode\n```\n```\n```'
    expect(normalizeMdx(source)).toBe('`````mdx\n````bash\n```diff\ncode\n```\n````\n`````')
  })

  it('leaves ordinary, unnested code fences untouched', () => {
    const source = '```js\nconst x = 1\n```\n\nMore prose.\n\n```py\nx = 1\n```'
    expect(normalizeMdx(source)).toBe(source)
  })

  it('leaves unbalanced fences untouched rather than guessing', () => {
    const source = '```mdx\n```bash\nnpm install x'
    expect(normalizeMdx(source)).toBe(source)
  })
})
