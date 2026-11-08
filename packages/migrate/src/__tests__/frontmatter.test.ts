/** The package's frontmatter parser must not be a code-execution sink. */

import { describe, expect, it } from 'vitest'

import { parseFrontmatter } from '../frontmatter.js'
import { parseMarkdownPage } from '../mdx.js'

describe('parseFrontmatter', () => {
  it('does not execute javascript frontmatter', () => {
    const marker = '__migrate_frontmatter_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    const parsed = parseFrontmatter(
      `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
    )

    expect(globals[marker]).toBeUndefined()
    expect(parsed.data.title).toBeUndefined()
  })

  it('still parses the documented yaml frontmatter', () => {
    const parsed = parseFrontmatter('---\ntitle: Hello\n---\n\nBody.')
    expect(parsed.data.title).toBe('Hello')
    expect(parsed.content.trim()).toBe('Body.')
  })

  it('salvages readable fields and reports an error instead of throwing on invalid yaml', () => {
    // A bare backtick is a reserved YAML indicator; this mirrors crewAI's
    // ragtool.mdx frontmatter that previously aborted the whole migration.
    const parsed = parseFrontmatter(
      '---\ntitle: RagTool\ndescription: `RagTool` is great\n---\n\nBody.',
    )
    expect(parsed.error).toBeDefined()
    expect(parsed.data.title).toBe('RagTool')
    expect(parsed.data.description).toBeUndefined()
    expect(parsed.content.trim()).toBe('Body.')
  })
})

describe('parseFrontmatter with a quoted value that continues on an unindented line', () => {
  const parse = (matter: string) => parseFrontmatter(`---\n${matter}\n---\n\nBody.`)

  it('folds the line break to a space, as Mintlify does, when the closing quote sits alone on the next line', () => {
    const parsed = parse('title: "Brand Assets"\ndescription: "Logos, guidelines, and assets for the brand clearly and consistently\n"\nicon: star')
    expect(parsed.error).toBeUndefined()
    expect(parsed.data).toEqual({ title: 'Brand Assets', description: 'Logos, guidelines, and assets for the brand clearly and consistently ', icon: 'star' })
  })

  it('folds a value that continues over several unindented lines, in either kind of quote', () => {
    expect(parse('description: "first part\nsecond part\nthird \\"part\\""').data.description).toBe('first part second part third "part"')
    expect(parse("description: 'it''s the first\nsecond'").data.description).toBe("it's the first second")
  })

  it('still reports a quote that is never closed, and keeps the fields before it', () => {
    const parsed = parse('title: Hello\ndescription: "never closed\nand goes on')
    expect(parsed.error).toBeDefined()
    expect(parsed.data.title).toBe('Hello')
    expect(parsed.data.description).toBeUndefined()
  })

  it('does not read on into the next field to find a closing quote, so a field after it is still read as its own', () => {
    const parsed = parse('description: "never closed\ngroups: [admin]\ntitle: "Hello"')
    expect(parsed.error).toBeDefined()
    expect(parsed.data.description).toBeUndefined()
    expect(parsed.data.groups).toEqual(['admin'])
  })

  it('does not accept a closing quote that is followed by more text', () => {
    const parsed = parse('title: Hello\ndescription: "first\nsecond" and more')
    expect(parsed.error).toBeDefined()
    expect(parsed.data.title).toBe('Hello')
  })
})

describe('parseMarkdownPage', () => {
  it.each(['', '{/* Removed unsupported component */}\n\n'])('separates Docusaurus display heading and sidebar label from the metadata title after %s', (prefix) => {
    const page = parseMarkdownPage({ id: 'guide', platform: 'docusaurus', source: 'guide.mdx',
      raw: `---\ntitle: Long SEO title\nsidebar_label: Short sidebar label\n---\n\n${prefix}# Display title\n\nBody.`,
    })
    expect(page?.title).toBe('Long SEO title')
    expect(page?.headingTitle).toBe('Display title')
    expect(page?.navTitle).toBe('Short sidebar label')
    expect(page?.body).not.toContain('# Display title')
  })

  it('keeps the authored description of a Mintlify page whose quoted description breaks onto an unindented line', () => {
    const page = parseMarkdownPage({ id: 'brand', platform: 'mintlify', source: 'brand.mdx',
      raw: '---\ntitle: "Brand Assets"\ndescription: "Logos, guidelines, and assets for presenting the brand clearly and consistently\n"\n---\n\nGuidelines for the brand.\n',
    })
    expect(page?.description).toBe('Logos, guidelines, and assets for presenting the brand clearly and consistently')
    expect(page?.descriptionPlacement).toBeUndefined()
    expect(page?.frontmatterError).toBeUndefined()
  })

  it.each(['mintlify', 'fern', 'docusaurus'] as const)('reports cyclic metadata safely for %s', (platform) => {
    const warnings: string[] = []
    const page = parseMarkdownPage({
      id: 'cyclic', platform, source: 'cyclic.mdx', warn: (message) => warnings.push(message),
      raw: '---\nauthMethod: &loop [*loop]\nplayground: *loop\n---\nBody.',
    })
    expect(page?.authMethod).toBeUndefined()
    expect(page?.playground).toBeUndefined()
    expect(warnings).toHaveLength(2)
    expect(warnings.join(' ')).toContain('authMethod')
    expect(warnings.join(' ')).toContain('playground')
  })

  it.each(['mintlify', 'fern', 'docusaurus'] as const)('drops non-string icon variants for %s', (platform) => {
    for (const value of ['{toString: null}', '[solid]', 'null', '42', 'true']) {
      const page = parseMarkdownPage({
        id: 'typed', platform, source: 'typed.mdx',
        raw: `---\nicon: book\niconType: ${value}\n---\nBody.`,
      })
      expect(page?.icon).toBe('book')
      expect(page?.iconType).toBeUndefined()
    }
    for (const value of ['regular', 'solid', 'outline', 'brands']) {
      expect(parseMarkdownPage({
        id: 'typed', platform, source: 'typed.mdx',
        raw: `---\nicon: book\niconType: ${value}\n---\nBody.`,
      })?.iconType).toBe(value)
    }
  })

  describe('object-form icon', () => {
    const parse = (icon: string, extra: { siteIconLibrary?: string } = { siteIconLibrary: 'fontawesome' }) => {
      const warnings: Array<string> = []
      const page = parseMarkdownPage({ id: 'guide', platform: 'mintlify', source: 'guide.mdx', raw: `---\n${icon}\n---\nBody.`, warn: (message) => warnings.push(message), ...extra })
      return { page, warnings }
    }

    it('maps name to icon and a supported style to iconType', () => {
      const { page, warnings } = parse('icon:\n  name: "rocket"\n  style: "solid"\n  library: "fontawesome"')
      expect(page).toMatchObject({ icon: 'rocket', iconType: 'solid' })
      expect(warnings).toEqual([])
    })

    it('keeps just the name when no style is given, and falls back to a top-level iconType', () => {
      expect(parse('icon:\n  name: rocket').page).toMatchObject({ icon: 'rocket', iconType: undefined })
      expect(parse('icon:\n  name: rocket\niconType: brands').page).toMatchObject({ icon: 'rocket', iconType: 'brands' })
      expect(parse('icon:\n  name: rocket\n  style: regular\niconType: brands').page?.iconType).toBe('regular')
    })

    it('ignores a style the page icon cannot express but keeps the name', () => {
      for (const style of ['duotone', 'sharp-solid', '[solid]', '42']) {
        expect(parse(`icon:\n  name: rocket\n  style: ${style}`).page).toMatchObject({ icon: 'rocket', iconType: undefined })
      }
      expect(parse('icon:\n  name: rocket\n  style: duotone\niconType: solid').page?.iconType).toBe('solid')
    })

    it('ignores an object with no usable name without failing the page', () => {
      for (const icon of ['icon:\n  style: solid', 'icon:\n  name: 5', 'icon:\n  name: "  "', 'icon: [rocket]', 'icon: {}', 'icon:\n  name: [rocket]']) {
        const { page, warnings } = parse(icon)
        expect(page).toMatchObject({ icon: undefined, iconType: undefined })
        expect(warnings).toEqual([])
      }
    })

    it('warns when the page names a different icon library than the site uses, and only then', () => {
      const lucide = 'icon:\n  name: rocket\n  library: lucide'
      const { page, warnings } = parse(lucide)
      expect(page?.icon).toBe('rocket')
      expect(warnings).toEqual([expect.stringMatching(/Page "guide".*"lucide".*site uses "fontawesome".*"rocket"/)])
      expect(parse(lucide, { siteIconLibrary: 'lucide' }).warnings).toEqual([])
      expect(parse('icon:\n  name: rocket\n  library: fontawesome', { siteIconLibrary: 'tabler' }).warnings).toHaveLength(1)
      expect(parse('icon:\n  name: rocket\n  library: 5').warnings).toEqual([])
      // With no site library to compare against, nothing is claimed.
      expect(parse(lucide, {}).warnings).toEqual([])
    })
  })

  it('does not execute javascript frontmatter in scraped pages', () => {
    const marker = '__migrate_page_frontmatter_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    parseMarkdownPage({
      id: 'scraped',
      raw: `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
      source: 'https://example.com/scraped',
    })

    expect(globals[marker]).toBeUndefined()
  })

  it('keeps the page and flags frontmatterError instead of aborting on invalid yaml', () => {
    const page = parseMarkdownPage({
      id: 'ragtool',
      raw: '---\ntitle: RagTool\ndescription: `RagTool` is great\n---\n\nBody text.',
      source: 'docs/ragtool.mdx',
    })

    expect(page).not.toBeNull()
    expect(page?.title).toBe('RagTool')
    expect(page?.frontmatterError).toBeDefined()
    expect(page?.description).toContain('Body text.')
  })
})

describe('parseMarkdownPage description', () => {
  const parse = (frontmatter: string) =>
    parseMarkdownPage({ id: 'p', raw: `---\ntitle: P\n${frontmatter}---\n\nFirst paragraph of the body.\n`, source: 'p.mdx' })

  it('derives a description from the body for ordinary pages', () => {
    expect(parse('')?.description).toBe('First paragraph of the body.')
  })

  it('does not derive one from the body for an openapi page, but keeps an authored one', () => {
    expect(parse('openapi: "openapi.json POST /scrape"\n')?.description).toBe('')
    expect(parse('openapi: "openapi.json POST /scrape"\ndescription: Authored\n')?.description).toBe('Authored')
  })
})

describe('Mintlify metadata compatibility', () => {
  it('reports omitted platform fields while preserving display and visibility metadata', () => {
    const warnings: string[] = []
    const page = parseMarkdownPage({ id: 'guide', platform: 'mintlify', source: 'guide.mdx', warn: (message) => warnings.push(message), raw: '---\ntitle: Guide\nsidebarTitle: Short\nhidden: true\nnoindex: true\nmode: frame\nlayout: custom-vendor-layout\n---\nBody.' })
    expect(page).toMatchObject({ title: 'Guide', navTitle: 'Short', hidden: true, noindex: true, mode: 'wide' })
    expect(warnings).toEqual([expect.stringContaining('layout')])
  })
})
