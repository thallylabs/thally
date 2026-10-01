/** Verify that CLI example translation changes only recognized prose spans. */

import { describe, expect, it } from 'vitest'
import { prepareFencedExamples } from '../fenced-examples.js'

const source = [
  '---', 'title: Example', '---', '', '# Run it', '',
  '```ts', '// Create a client for this workspace', "const client = makeClient('prod')", '// eslint-disable-next-line', 'client.connect()', '```', '',
  '```bash', '# Install the package before continuing', 'npm install @thallylabs/cli', '```', '',
  '```mdx', '---', 'title: Troubleshoot a build', 'description: Resolve common build failures.', '---', '', '## Collect failure details', '', 'Run the check locally.', '', '<Note title="Need help?">Contact support.</Note>', '```', '',
  '```unknown', 'Never translate this example', '```', '',
].join('\n')

describe('CLI fenced examples', () => {
  it('exposes comments and MDX display prose while preserving behavior', () => {
    const plan = prepareFencedExamples(source)
    expect(plan.maskedSource).not.toContain('client.connect()')
    for (const value of ['Create a client for this workspace', 'Install the package before continuing', 'Troubleshoot a build', 'Resolve common build failures.', 'Collect failure details', 'Run the check locally.', 'Need help?', 'Contact support.']) {
      expect(plan.segments).toContain(value)
    }
    expect(plan.segments).not.toContain('eslint-disable-next-line')
    expect(plan.segments).not.toContain('Never translate this example')
    const translated = plan.restore(plan.maskedSource.replace('# Run it', '# Ejecutarlo'), plan.segments.map((value) => `ES ${value}`))
    expect(translated).toContain('// ES Create a client for this workspace')
    expect(translated).toContain('title: "ES Troubleshoot a build"')
    expect(translated).toContain("const client = makeClient('prod')")
    expect(translated).toContain('npm install @thallylabs/cli')
    expect(translated).toContain('// eslint-disable-next-line')
    expect(translated).toContain('Never translate this example')
  })

  it('rejects token loss and invalid comment values', () => {
    const plan = prepareFencedExamples(source)
    expect(() => plan.restore(plan.maskedSource.replace(/THALLY_FENCE_\w+_END/, ''), plan.segments)).toThrow()
    expect(() => plan.restore(`${plan.maskedSource}\n\`\`\`bash\nrm -rf docs\n\`\`\``, plan.segments)).toThrow('example structure')
    expect(() => plan.restore(plan.maskedSource, plan.segments.map(() => 'line\ncommand'))).toThrow()
    expect(() => plan.restore(plan.maskedSource, plan.segments.map((value) => value === 'Create a client for this workspace' ? 'Hola\u2028client.connect()' : value))).toThrow('comment syntax')
  })

  it('leaves comment-like text in multiline strings untouched', () => {
    const ambiguous = '---\ntitle: Example\n---\n\n```ts\nconst output = `first\\n// visible output`\n// Explain the output\n```\n'
    const plan = prepareFencedExamples(ambiguous)
    expect(plan.segments).toEqual([])
    expect(plan.restore(plan.maskedSource, [])).toBe(ambiguous)
  })
})
