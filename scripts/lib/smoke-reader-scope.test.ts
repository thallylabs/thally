/** Smoke expectations come from authored policy, never from the endpoints under test. */
import { describe, expect, it } from 'vitest'
import { anonymousSmokeScope, smokeUtilityPaths } from './smoke-reader-scope'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const file = (frontmatter = '', body = 'Body') => ({ content: `---\n${frontmatter}\n---\n${body}` })
describe('anonymous smoke source scope', () => {
  it('starts the actual ESM smoke command through tsx before evaluating an HTTP failure', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'thally-smoke-startup-'))
    const server = createServer((_request, response) => { response.writeHead(503); response.end('fixture unavailable') })
    try {
      mkdirSync(path.join(root, 'src/content'), { recursive: true })
      writeFileSync(path.join(root, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs', pages: ['introduction'] }] }))
      writeFileSync(path.join(root, 'src/content/introduction.mdx'), '---\ntitle: Public overview\npublic: true\n---\nBody')
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Startup fixture is unavailable')
      const result = await promisify(execFile)(process.execPath, [path.join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', path.join(process.cwd(), 'tsconfig.json'), path.join(process.cwd(), 'scripts/smoke-cloudflare.mts')], {
        cwd: root, env: { ...process.env, THALLY_CLOUDFLARE_SMOKE_URL: `http://127.0.0.1:${address.port}` }, timeout: 8_000,
      }).then((result) => ({ ...result, failed: false }), (error: { stdout: string; stderr: string }) => ({ stdout: error.stdout, stderr: error.stderr, failed: true }))
      expect(result.failed).toBe(true)
      expect(result.stdout, result.stderr).toContain('[cloudflare-smoke] anonymous scope from local authored source: 1 public navigation page(s)')
      expect(result.stderr).toContain('home returned 503')
      expect(result.stderr).not.toContain('does not provide an export')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)
  it('keeps a public overview CTA to a protected target without expecting that target to be public', () => {
    const scope = anonymousSmokeScope({ auth: { mode: 'jwt', default: 'private' }, tabs: [{ tab: 'Docs', pages: ['private', 'introduction', 'group'] }] }, {
      'src/content/introduction.mdx': file('public: true\nmode: home', '[Start integration](/private)'),
      'src/content/private.mdx': file('public: false'),
      'src/content/group.mdx': file('groups: [beta]\npublic: true'),
    })
    expect(scope.publicNavigationIds).toEqual(['introduction'])
    expect(scope.protectedPageIds).toEqual(['private', 'group'])
    expect(scope.isRootPublic).toBe(true)
  })
  it('preserves plain-file site defaults and recognizes a legitimate all-private fixture', () => {
    const sources = { 'src/content/plain.mdx': { content: 'No frontmatter' } }
    const config = { tabs: [{ tab: 'Docs', pages: ['plain'] }] }
    expect(anonymousSmokeScope(config, sources).publicPageIds).toEqual(['plain'])
    const privateScope = anonymousSmokeScope({ ...config, auth: { mode: 'jwt' } }, sources)
    expect(privateScope.publicPageIds).toEqual([])
    expect(privateScope.protectedPageIds).toEqual(['plain'])
    expect(privateScope.isRootPublic).toBe(false)
  })
  it('keeps physical direct-file precedence, malformed closure, public orphans and custom locale exclusions', () => {
    const scope = anonymousSmokeScope({ tabs: [{ tab: 'Docs', pages: ['guide', 'bad'] }], i18n: { locales: [{ code: 'custom' }] } }, {
      'src/content/guide.mdx': file('public: false'),
      'src/content/guide/index.mdx': file('public: true'),
      'src/content/bad.mdx': file('groups: [unclosed'),
      'src/content/orphan.mdx': file('public: true'),
      'src/content/custom/translated.mdx': file('public: true'),
    })
    expect(scope.publicPageIds).toEqual(['orphan'])
    expect(scope.protectedPageIds).toEqual(['guide', 'bad'])
  })
  it('follows an explicit root redirect rather than assuming a public introduction owns the root', () => {
    const scope = anonymousSmokeScope({ tabs: [{ tab: 'Docs', pages: ['introduction', 'private'] }], redirects: [{ source: '/', destination: '/private' }] }, {
      'src/content/introduction.mdx': file('public: true\nmode: home'), 'src/content/private.mdx': file('public: false'),
    })
    expect(scope.isRootPublic).toBe(false)
    expect(scope.publicNavigationIds).toEqual(['introduction'])
  })
  it('retains generated utility checks without treating authored private CTA links as public200 claims', () => {
    const body = '- Documentation: https://docs.example\n- Agent discovery (ai.txt): https://docs.example/ai.txt\n- Agent readiness: https://docs.example/api/agent-readiness\n- Changelog feed (RSS): https://docs.example/changelog/rss.xml\n- Per-page API: https://docs.example/api/docs/{page-id}\n- OpenAPI spec: https://docs.example/openapi.yaml\n\n[Start integration](https://docs.example/private)'
    expect(smokeUtilityPaths(body, { samplePageId: 'overview', allowsUnmarked: true, isRootPublic: true })).toEqual(['/', '/ai.txt', '/api/agent-readiness', '/changelog/rss.xml', '/api/docs/overview', '/openapi.yaml'])
    expect(smokeUtilityPaths(body, { allowsUnmarked: false, isRootPublic: false })).toEqual(['/ai.txt', '/api/agent-readiness', '/changelog/rss.xml'])
  })
})
