import { describe, expect, it } from 'vitest'
import { parseMdxContent } from '../parse'
import { slugify } from '../../slugify'

const sample = `## Getting Started

Install the package and run the dev server.

\`\`\`bash Install
npm install thally
\`\`\`

### Configuration

Set your \`API_KEY\` in the environment.

<Steps>
<Step title="First step">

#### Nested heading

Some prose with a [link](https://example.com/docs).

\`\`\`ts
const x = 1
\`\`\`

</Step>
</Steps>

## Getting Started
`

describe('parseMdxContent', () => {
  const parsed = parseMdxContent(sample)

  it('extracts headings including nested ones inside JSX', () => {
    const texts = parsed.headings.map((h) => h.text)
    expect(texts).toContain('Getting Started')
    expect(texts).toContain('Configuration')
    expect(texts).toContain('Nested heading')
  })

  it('uses the renderer slugger and de-duplicates ids', () => {
    const ids = parsed.headings.filter((h) => h.text === 'Getting Started').map((h) => h.id)
    expect(ids[0]).toBe(slugify('Getting Started'))
    // The duplicate heading must get a unique id so anchors do not collide.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('extracts code blocks with language and fence title', () => {
    expect(parsed.codeBlocks).toHaveLength(2)
    expect(parsed.codeBlocks[0]).toMatchObject({ language: 'bash', title: 'Install', index: 0 })
    expect(parsed.codeBlocks[0].source).toBe('npm install thally')
    expect(parsed.codeBlocks[1]).toMatchObject({ language: 'ts', index: 1 })
  })

  it('extracts prose text without fenced code', () => {
    expect(parsed.text).toContain('Install the package')
    expect(parsed.text).not.toContain('npm install thally')
    expect(parsed.text).not.toContain('const x = 1')
  })

  it('extracts links', () => {
    expect(parsed.links).toContainEqual({ url: 'https://example.com/docs', text: 'link' })
  })

  it('builds a nested table of contents', () => {
    const top = parsed.toc.find((item) => item.text === 'Getting Started')
    expect(top?.children?.some((c) => c.text === 'Configuration')).toBe(true)
  })

  it('produces heading-bounded sections anchored to heading ids', () => {
    const config = parsed.sections.find((s) => s.title === 'Configuration')
    expect(config).toBeDefined()
    expect(config?.id).toBe(slugify('Configuration'))
    expect(config?.text).toContain('Set your')
    expect(config?.headingPath).toEqual(['Getting Started', 'Configuration'])

    const nested = parsed.sections.find((s) => s.title === 'Nested heading')
    expect(nested?.code.some((c) => c.language === 'ts')).toBe(true)
  })
})

describe('parseMdxContent JSX attribute prose', () => {
  it('lifts literal prose attributes into section text, in reader order', () => {
    const parsed = parseMdxContent(
      '## Cards\n\n<Card title="Shape the navigation" icon="book-open">\nOrganize pages into tabs.\n</Card>\n',
    )
    const section = parsed.sections.find((s) => s.title === 'Cards')
    expect(section?.text).toBe('Shape the navigation\nOrganize pages into tabs.')
  })

  it('lifts attributes from self-closing elements', () => {
    const parsed = parseMdxContent('## Media\n\n<Frame caption="Dashboard overview" />\n')
    expect(parsed.text).toContain('Dashboard overview')
  })

  it('lifts attributes from inline elements without gluing words', () => {
    const parsed = parseMdxContent('## Terms\n\nHover the <Tooltip tip="Service level agreement">SLA</Tooltip> badge.\n')
    expect(parsed.text).toContain('Service level agreement')
    expect(parsed.text).toContain('SLA')
  })

  it('ignores expression values, empty strings, and non-prose attributes', () => {
    const parsed = parseMdxContent(
      '## Edge\n\n<Card title={dynamicTitle} icon="party-horn" href="/quickstart">\nBody prose.\n</Card>\n\n<Card title="">\nMore prose.\n</Card>\n',
    )
    expect(parsed.text).toContain('Body prose.')
    expect(parsed.text).toContain('More prose.')
    expect(parsed.text).not.toContain('dynamicTitle')
    expect(parsed.text).not.toContain('party-horn')
    expect(parsed.text).not.toContain('/quickstart')
  })
})
