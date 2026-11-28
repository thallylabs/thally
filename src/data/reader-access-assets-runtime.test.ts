/** Real workerd, real manifest/body reads, and the production metadata seam without an index. */
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../lib/frontmatter'

const document = (title: string, access = '') => `---\ntitle: ${title}\n${access}\n---\nBody`
const files: Record<string, string> = {
  'src/content/introduction.mdx': document('Public overview', 'public: true') + '\n[Start integration](/integration/quickstart)',
  'src/content/products/one.mdx': document('Product one', 'public: true'),
  'src/content/products/ciam.mdx': document('Product CIAM', 'public: true'),
  'src/content/integration/quickstart.mdx': document('PRIVATE QUICKSTART SENTINEL', 'public: false') + '\nPRIVATE BODY SENTINEL',
  'src/content/integration/signals.mdx': document('PRIVATE GROUP SENTINEL', 'groups: [engineers]\npublic: true'),
  'src/content/integration/journeys.mdx': 'Plain source without frontmatter',
  'src/content/reference/broken.mdx': '---\ntitle: [unclosed\n---\nPRIVATE MALFORMED BODY',
  'src/content/orphan/index.mdx': document('Public orphan', 'public: true'),
  'src/content/fr/integration/quickstart.mdx': document('Private primary stays closed', 'public: true'),
}
const config = {
  auth: { mode: 'jwt', default: 'private' },
  tabs: [{ tab: 'Docs', pages: ['introduction', 'products/one', 'products/ciam', 'integration/quickstart', 'integration/signals', 'integration/journeys', 'reference/broken', 'missing'] }],
  i18n: { defaultLocale: 'en', locales: [{ code: 'en' }, { code: 'fr' }] },
}
const index = { version: 1, pages: Object.fromEntries(Object.entries(files).map(([file, content]) => {
  let data: Record<string, unknown>
  try { data = parseFrontmatter(content).data } catch { data = { __thallyFrontmatterError: true } }
  return [file, { data, modifiedAtMs: 1 }]
})) }
const manifest = { version: 1, files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, { modifiedAtMs: 1, sha256: createHash('sha256').update(content).digest('hex') }])) }
const scenarios = ['no-index', 'inline-index', 'large-asset-index', 'malformed-index', 'unavailable-index', 'absent-source', 'malformed-source', 'unreadable-source', 'concurrent-no-index', 'index-recovery']
interface FixtureFetcher { fetch(input: string): Promise<Response> }
/** Validate the documented binding seam independently of provider type replacement versions. */
function isFixtureFetcher(value: unknown): value is FixtureFetcher {
  return typeof value === 'object' && value !== null && 'fetch' in value && typeof value.fetch === 'function'
}

const entry = `
import { loadDocEntries, loadSidebarCollections, loadPageAccess, loadReferencedReaderGroups, canReaderViewPage } from "./docs";
import { getContentSource } from "../lib/content-source";
import { setContentAssetFetcher } from "../lib/content-source/runtime";
export default {
  async fetch(request, env) {
    setContentAssetFetcher(path => env.ASSETS.fetch(new URL(path, "https://assets.local")));
    const url = new URL(request.url);
    if (url.pathname === "/recover") await env.ASSETS.fetch("https://assets.local/_fixture/recover");
    const groups = url.searchParams.get("reader");
    const reader = groups ? { isAuthenticated: true, source: "session", groups: groups === "member" ? [] : [groups] } : undefined;
    try {
      if (url.pathname.startsWith("/page/")) {
        const id = url.pathname.slice(6);
        if (!(await canReaderViewPage(id, reader, url.searchParams.get("locale") || undefined))) return new Response("Not found", { status: 404 });
        const file = await getContentSource().readPublished("src/content/" + id + ".mdx");
        return new Response(file?.content || "", { headers: { "content-type": "text/markdown" } });
      }
      const [entries, sidebar, access, groups] = await Promise.all([
        loadDocEntries(reader), loadSidebarCollections(undefined, reader), loadPageAccess("integration/quickstart", "fr"), loadReferencedReaderGroups(),
      ]);
      return Response.json({ entries: entries.map(({ id, title }) => ({ id, title })), sidebar, access, groups: [...groups] });
    } catch (error) {
      return Response.json({ error: error.code || error.name }, { status: 503 });
    }
  },
};
`

describe('asset metadata visibility in workerd', () => {
  let runtime: Miniflare
  beforeAll(async () => {
    const bundle = await build({
      stdin: { contents: entry, resolveDir: path.join(process.cwd(), 'src/data'), loader: 'js' },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'],
      plugins: [{ name: 'fixture-authored-config', setup(plugin) {
        plugin.onResolve({ filter: /^@\/lib\/(?:runtime-sources|docs-json-config)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ loader: 'js', contents: args.path.endsWith('docs-json-config')
          ? `const config = ${JSON.stringify(config)}; export function getDocsJsonConfig() { return config; } export function getDocsJsonConfigRevision() { return 1; }`
          : 'export function runtimeSourceExists() { return false; } export function listRuntimeSources() { return []; } export function readRuntimeSource() { throw new Error("No embedded source"); } export function runtimeSourceModifiedAt() { return 0; } export function runtimeSourcePageUpdate() {}' }))
      } }],
    })
    const largeIndex = JSON.stringify({ ...index, pages: Object.fromEntries(Object.entries(index.pages).map(([path, entry]) => [path, { ...entry, data: { ...entry.data, padding: 'x'.repeat(1024) } }])) })
    expect(largeIndex.length).toBeGreaterThan(5 * 1024)
    const workers = scenarios.flatMap((scenario) => [
      { name: scenario, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-15', compatibilityFlags: ['nodejs_compat'],
        bindings: { THALLY_CONTENT_SOURCE: 'assets', ...(scenario === 'inline-index' ? { THALLY_CONTENT_INDEX: JSON.stringify(index) } : {}) },
        serviceBindings: { ASSETS: `assets-${scenario}` },
      },
      { name: `assets-${scenario}`, modules: true, compatibilityDate: '2026-07-15', script: `
        const files = ${JSON.stringify(files)};
        let recovered = false;
        export default { async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/_fixture/recover") { recovered = true; return new Response("ok"); }
          await new Promise(resolve => setTimeout(resolve, 2));
          if (path.endsWith("/manifest.json")) {
            if (${JSON.stringify(scenario)} === "absent-source") return new Response("missing", { status: 404 });
            return new Response(${JSON.stringify(scenario === 'malformed-source' ? '{invalid' : JSON.stringify(manifest))});
          }
          if (path === "/_thally/content/index.json") {
            if (${JSON.stringify(scenario)} === "index-recovery" && recovered) return new Response(${JSON.stringify(JSON.stringify({ version: 1, pages: { 'src/content/introduction.mdx': { data: { title: 'Recovered authoritative index', public: true }, modifiedAtMs: 2 } } }))});
            if (${JSON.stringify(scenario)} === "large-asset-index") return new Response(${JSON.stringify(largeIndex)});
            if (${JSON.stringify(scenario)} === "malformed-index") return new Response("{invalid");
            return new Response("missing", { status: ${scenario === 'unavailable-index' ? 503 : 404} });
          }
          const file = decodeURIComponent(path.slice("/_thally/content/".length));
          if (${JSON.stringify(scenario)} === "unreadable-source" && file.includes("quickstart")) return new Response("unavailable", { status: 503 });
          return file in files ? new Response(files[file]) : new Response("missing", { status: 404 });
        } };
      ` },
    ])
    runtime = new Miniflare(convertV4MiniflareOptions({ workers }))
    await runtime.ready
  }, 60_000)
  afterAll(async () => { await runtime?.dispose() })
  async function fetchFixture(scenario: string, pathname = '/') {
    const worker = await runtime.getWorker(scenario)
    if (!isFixtureFetcher(worker)) throw new Error('Fixture Worker binding is unavailable')
    return worker.fetch('http://fixture' + pathname)
  }
  it.each(scenarios.slice(0, 5))('keeps automatic private entries/title/body out of %s projections', async (scenario) => {
    const response = await fetchFixture(scenario)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toMatch(/PRIVATE|integration\/quickstart|integration\/signals/)
    expect(JSON.parse(body).entries.map((entry: { id: string }) => entry.id)).toEqual(['introduction', 'products/one', 'products/ciam', 'orphan'])
    expect((await fetchFixture(scenario, '/page/integration/quickstart')).status).toBe(404)
    const overview = await fetchFixture(scenario, '/page/introduction')
    expect(overview.status).toBe(200)
    expect(await overview.text()).toContain('[Start integration](/integration/quickstart)')
  })
  it.each(scenarios.slice(5, 8))('fails closed on %s instead of accepting fallback emptiness', async (scenario) => {
    expect((await fetchFixture(scenario)).status).toBe(503)
    expect((await fetchFixture(scenario, '/page/introduction')).status).toBe(503)
  })
  it('shares cold metadata across actual concurrent requests with delayed asset bodies', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetchFixture('concurrent-no-index')))
    for (const response of responses) { expect(response.status).toBe(200); expect(await response.text()).not.toContain('PRIVATE') }
  })
  it('keeps authenticated ungrouped/group views separate and translations restrictive', async () => {
    expect((await fetchFixture('no-index', '/page/integration/quickstart?reader=member')).status).toBe(200)
    expect((await fetchFixture('no-index', '/page/integration/signals?reader=member')).status).toBe(404)
    expect((await fetchFixture('no-index', '/page/integration/signals?reader=engineers')).status).toBe(200)
    expect((await fetchFixture('no-index', '/page/integration/quickstart?locale=fr')).status).toBe(404)
    expect((await fetchFixture('no-index', '/page/reference/broken?reader=engineers')).status).toBe(404)
  })
  it('replaces fallback entries/sidebar/groups when the real asset index recovers after loader backoff', async () => {
    const before = await (await fetchFixture('index-recovery')).json() as { entries: Array<{ title: string }> }
    expect(before.entries[0].title).toBe('Public overview')
    await (await fetchFixture('index-recovery', '/recover')).arrayBuffer()
    await new Promise((resolve) => setTimeout(resolve, 5_100))
    const response = await fetchFixture('index-recovery')
    expect(response.status).toBe(200)
    const after = await response.json() as { entries: Array<{ title: string }>; groups: string[]; sidebar: unknown }
    expect(after.entries).toEqual([{ id: 'introduction', title: 'Recovered authoritative index' }])
    expect(after.groups).toEqual([])
    expect(JSON.stringify(after.sidebar)).not.toContain('Product one')
  }, 10_000)
})
