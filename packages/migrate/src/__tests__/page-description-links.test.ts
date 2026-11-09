/** Thally shows a page description as plain text (with inline code), so a Markdown link in an authored one keeps only its text. */

import { describe, expect, it } from 'vitest'

import { parseMarkdownPage } from '../mdx.js'
import type { MigrationPlatform } from '../types.js'

function describe_(description: string, platform: MigrationPlatform = 'mintlify'): { description: string | undefined; warnings: Array<string> } {
  const warnings: Array<string> = []
  const raw = `---\ntitle: Koyeb\ndescription: ${JSON.stringify(description)}\n---\n\nBody paragraph.\n`
  const page = parseMarkdownPage({ id: 'guides/koyeb', raw, source: 'guides/koyeb.mdx', platform, warn: (message) => warnings.push(message) })
  return { description: page?.description, warnings }
}

const WARNING = 'Page "guides/koyeb": its description had links, which Thally shows as plain text; only the link text was kept and the link addresses were dropped; add the links to the page body if you need them.'

describe('a Markdown link in an authored page description', () => {
  it('keeps the link text and warns once for the page', () => {
    const { description, warnings } = describe_('Deploy a JavaScript/Rust app using [Turso Cloud embedded replicas](/features/embedded-replicas) to [Koyeb](https://www.koyeb.com/).')
    expect(description).toBe('Deploy a JavaScript/Rust app using Turso Cloud embedded replicas to Koyeb.')
    expect(warnings).toEqual([WARNING])
  })

  it('leaves inline code and every other character as written', () => {
    expect(describe_('Call [`client.sync()`](/sdk) to sync with care & <b>speed</b>, 5 < 6 {ok}.').description)
      .toBe('Call `client.sync()` to sync with care & <b>speed</b>, 5 < 6 {ok}.')
    expect(describe_('A [**bold** link](/x) and [a `code` link](/y).').description).toBe('A bold link and a `code` link.')
  })

  it('drops emphasis markers, which the page header prints as typed, and keeps code, snake_case and literal asterisks', () => {
    for (const [written, shown] of [
      ['Works at the **cryptographic curve** level.', 'Works at the cryptographic curve level.'],
      ['With *care*, _more care_ and __strong__ care.', 'With care, more care and strong care.'],
      ['Call `a **b**` and my_var_name and 2 * 3 * 4.', 'Call `a **b**` and my_var_name and 2 * 3 * 4.'],
    ]) {
      const result = describe_(written)
      expect(result.description).toBe(shown)
      expect(result.warnings).toEqual([])
    }
  })

  it('puts the original description at the top of an empty body so its links survive', () => {
    const warnings: Array<string> = []
    const raw = '---\ntitle: Foundry\ndescription: "See [the **SDK**](https://x.dev/sdk) {now}."\n---\n\n  \n'
    const page = parseMarkdownPage({ id: 'sdks/foundry', raw, source: 'sdks/foundry.mdx', platform: 'mintlify', warn: (message) => warnings.push(message) })
    expect(page?.description).toBe('See the SDK {now}.')
    expect(page?.body).toBe('See [the **SDK**](https://x.dev/sdk) \\{now\\}.')
    expect(warnings).toEqual(['Page "sdks/foundry": its description had links, which Thally shows as plain text; the link text was kept in the description and the original description, with its links, was added to the top of the empty page body.'])
  })

  it('reads a link the way Markdown does', () => {
    expect(describe_('[a](https://x.com/a_(b)) [c](/c "A title") [d](<https://x.com/d e>) [e [f]](/e)').description).toBe('a c d e [f]')
    expect(describe_('See <https://turso.tech/docs> now.').description).toBe('See https://turso.tech/docs now.')
  })

  it('leaves what is not a link as it is, without a warning', () => {
    for (const text of [
      'Plain description with no links.',
      'Use the `[text](url)` syntax for links.',
      'A \\[bracketed\\](/not-a-link) phrase.',
      'An image ![logo](/logo.png) stays.',
      'A [reference][ref] and a [shortcut] without definitions.',
      'A bare address https://turso.tech stays.',
    ]) {
      const result = describe_(text)
      expect(result.description).toBe(text)
      expect(result.warnings).toEqual([])
    }
  })

  it.each<MigrationPlatform>(['mintlify', 'fern', 'docusaurus'])('does the same for %s pages', (platform) => {
    const { description, warnings } = describe_('Read the [guide](/guide) first.', platform)
    expect(description).toBe('Read the guide first.')
    expect(warnings).toEqual([WARNING])
  })

  it('leaves a description taken from the body alone', () => {
    const page = parseMarkdownPage({ id: 'guides/koyeb', raw: '---\ntitle: Koyeb\n---\n\nRead the [guide](/guide) first.\n', source: 'guides/koyeb.mdx', platform: 'mintlify' })
    expect(page?.description).toBe('Read the guide first.')
  })
})
