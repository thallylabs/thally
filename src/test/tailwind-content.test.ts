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

  it('scans adversarial prose in linear time', async () => {
    const content = config.content as { transform: { mdx: (c: string) => string } }
    for (const input of ['w[var(a*'.repeat(6250), 'a'.repeat(50000), 'a['.repeat(25000), 'a[var('.repeat(8000), '[a*)var('.repeat(6000)]) {
      const start = performance.now()
      content.transform.mdx(input)
      expect(performance.now() - start).toBeLessThan(100)
    }
    expect(content.transform.mdx('x text-[length:var(--text-*)] y')).toBe('x  y')
  })
})
