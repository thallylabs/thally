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

describe('inline component hook imports', () => {
  function body(raw: string): string | undefined {
    return parseMarkdownPage({ id: 'page', raw, source: 'https://example.com/page' })?.body
  }

  it('imports hooks a page-local inline component calls without an import', () => {
    const page = body('export const Counter = () => {\n  const [n, setN] = useState(0)\n  return <button onClick={() => setN(n + 1)}>{n}</button>\n}\n\n<Counter />')
    expect(page).toMatch(/^import \{ useState \} from 'react'/)
  })

  it('imports only the hooks actually called, in the documented order', () => {
    const page = body('export const X = () => {\n  useEffect(() => {}, [])\n  const [n] = useState(0)\n  return <div>{n}</div>\n}')
    expect(page).toMatch(/^import \{ useState, useEffect \} from 'react'/)
  })

  it('does not add an import when no hook is called', () => {
    const source = '# Title\n\nJust prose.'
    expect(body(source)).toBe(source)
  })

  it('does not duplicate an import the page already has', () => {
    const source = "import { useState } from 'react'\n\nexport const Counter = () => {\n  const [n] = useState(0)\n  return <div>{n}</div>\n}"
    expect(body(source)).toBe(source)
  })

  it('does not import a hook shown only in a documentation code sample', () => {
    // The import alone (unused or not) marks the compiled page a Client
    // Component and breaks the Server Component build — showing readers what
    // a hook call looks like must not trigger it.
    const source = '```mdx\nexport const Counter = () => {\n  const [n] = useState(0)\n}\n```'
    expect(body(source)).toBe(source)
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

describe('orphan capitalized tag escaping', () => {
  it('escapes a bare placeholder tag that never closes or self-closes', () => {
    expect(normalizeMdx('Add a callout: "<Feature> requires a plan."'))
      .toBe('Add a callout: "&lt;Feature&gt; requires a plan."')
  })

  it('leaves a properly paired tag alone', () => {
    const source = '<Note>hello</Note>'
    expect(normalizeMdx(source)).toBe(source)
  })

  it('leaves a self-closing tag alone', () => {
    const source = '<Icon icon="download" />'
    expect(normalizeMdx(source)).toBe(source)
  })

  it('recognizes a self-closing tag whose last attribute value ends in a brace', () => {
    const source = '<Visits initial={4} />'
    expect(normalizeMdx(source)).toBe(source)
  })

  it('leaves a locally declared inline component alone', () => {
    const source = 'export const Counter = () => <div/>\n\n<Counter />'
    expect(normalizeMdx(source)).toBe(source)
  })

  it('leaves an imported component alone', () => {
    const source = "import { Widget } from '/snippets/widget.mdx'\n\n<Widget>"
    expect(normalizeMdx(source)).toBe(source)
  })

  it('does not touch tag-like text inside inline code or a fenced code block', () => {
    expect(normalizeMdx('Use `<Info>` for callouts.')).toBe('Use `<Info>` for callouts.')
    const fenced = '```mdx\n<Foo>\n```'
    expect(normalizeMdx(fenced)).toBe(fenced)
  })
})
