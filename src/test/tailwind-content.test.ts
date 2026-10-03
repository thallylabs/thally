import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import config from '../../tailwind.config'

async function css(raw: string): Promise<string> {
  const content = Array.isArray(config.content) ? { files: config.content } : config.content
  const result = await postcss([tailwindcss({ ...config, content: { ...content, files: [{ raw, extension: 'mdx' }] } })])
    .process('@tailwind utilities;', { from: undefined })
  return result.css
}

describe('tailwind content scanning of MDX prose', () => {
  it('does not generate a utility from a wildcard placeholder like text-[length:var(--text-*)]', async () => {
    const output = await css('Use `text-[length:var(--text-*)]` or p-4 here.')
    expect(output).not.toContain('--text-*')
    expect(output).toContain('.p-4')
  })

  it('still generates arbitrary-value classes written in MDX', async () => {
    const output = await css('<div className="w-[13px] text-[length:var(--text-body)]" />')
    expect(output).toContain('.w-\\[13px\\]')
    expect(output).toContain('var(--text-body)')
  })
})
