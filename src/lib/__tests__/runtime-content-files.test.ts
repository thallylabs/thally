/** Regression coverage for authored files embedded into self-hosted runtimes. */

import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  MANAGED_CONTENT_ASSET_DIRECTORY,
  collectRuntimeContentFiles,
  findShadowingPublicSpecs,
  writeManagedContentAssets,
} from '../../../scripts/lib/runtime-content-files'
import { sanitizeSpecForPublication } from '@/lib/openapi/sanitize'

const projectRoots: Array<string> = []

function createProject(source: string): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'thally-runtime-content-'))
  projectRoots.push(projectRoot)
  writeFileSync(
    path.join(projectRoot, 'docs.json'),
    JSON.stringify({ tabs: [{ tab: 'API', api: { source } }] }),
  )
  return projectRoot
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(projectRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('collectRuntimeContentFiles', () => {
  it('embeds a nested OpenAPI source configured in docs.json', () => {
    const projectRoot = createProject('openapi/cinderlane.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    writeFileSync(path.join(projectRoot, 'openapi/cinderlane.yaml'), 'openapi: 3.1.0\n')

    expect(collectRuntimeContentFiles(projectRoot)['openapi/cinderlane.yaml']?.content).toBe(
      'openapi: 3.1.0\n',
    )
  })

  it('writes sanitized specs (YAML and JSON) without x-excluded operations', () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/pub': { get: { responses: {} } },
        '/secret': { get: { 'x-excluded': true, responses: {} } },
        '/override': { get: { responses: {} } },
      },
    }
    writeFileSync(path.join(projectRoot, 'openapi/api.yaml'), stringifyYaml(doc))
    writeFileSync(path.join(projectRoot, 'openapi.json'), JSON.stringify(doc))
    writeFileSync(
      path.join(projectRoot, 'docs.json'),
      JSON.stringify({ tabs: [{ api: { source: 'openapi/api.yaml', overrides: { 'GET /override': { hidden: true } } } }] }),
    )

    const sources = collectRuntimeContentFiles(projectRoot)
    const yamlOut = parseYaml(sources['openapi/api.yaml']!.content)
    expect(Object.keys(yamlOut.paths)).toEqual(['/pub'])
    expect(sources['openapi/api.yaml']!.content).not.toContain('secret')
    expect(Object.keys(JSON.parse(sources['openapi.json']!.content).paths)).toEqual(['/pub', '/override'])
    expect(sources['openapi.json']!.content).not.toContain('secret')

    // Emitted managed asset is what the runtime will fetch; it must stay loadable.
    writeManagedContentAssets(projectRoot, sources)
    const served = readFileSync(path.join(projectRoot, MANAGED_CONTENT_ASSET_DIRECTORY, 'openapi/api.yaml'), 'utf8')
    expect(served).not.toContain('secret')
    expect(sanitizeSpecForPublication(parseYaml(served))).toEqual(parseYaml(served))
  })

  it('reports a public/openapi.json that would shadow the filtered /openapi.json route', () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'public'), { recursive: true })
    const doc = (flag: Record<string, unknown>) =>
      JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/a': { get: { ...flag, responses: {} } } } })
    writeFileSync(path.join(projectRoot, 'public/openapi.json'), doc({ 'x-hidden': true }))
    writeFileSync(path.join(projectRoot, 'public/openapi.yaml'), stringifyYaml(JSON.parse(doc({ 'x-excluded': true }))))
    expect(findShadowingPublicSpecs(projectRoot)).toEqual(['public/openapi.json', 'public/openapi.yaml'])

    // Nothing to filter: serving the raw file is harmless. Other names do not shadow a route.
    writeFileSync(path.join(projectRoot, 'public/openapi.json'), doc({}))
    writeFileSync(path.join(projectRoot, 'public/openapi.yaml'), 'not: [valid')
    writeFileSync(path.join(projectRoot, 'public/api.json'), doc({ 'x-hidden': true }))
    expect(findShadowingPublicSpecs(projectRoot)).toEqual([])
  })

  it('does not fail the build for an unparseable root spec', () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    writeFileSync(path.join(projectRoot, 'openapi/api.yaml'), 'openapi: 3.1.0\n')
    writeFileSync(path.join(projectRoot, 'openapi.yaml'), 'paths: [unclosed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(collectRuntimeContentFiles(projectRoot)['openapi.yaml']?.content).toBe('paths: [unclosed')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('openapi.yaml'))
    } finally {
      warn.mockRestore()
    }
  })

  it('maps URL-style configured paths to public assets', () => {
    const projectRoot = createProject('/specs/cinderlane.json')
    mkdirSync(path.join(projectRoot, 'public/specs'), { recursive: true })
    writeFileSync(path.join(projectRoot, 'public/specs/cinderlane.json'), '{"openapi":"3.1.0"}')

    expect(collectRuntimeContentFiles(projectRoot)).toHaveProperty('public/specs/cinderlane.json')
  })

  it('rejects a configured path that escapes the project', () => {
    const projectRoot = createProject('../outside.yaml')

    expect(() => collectRuntimeContentFiles(projectRoot)).toThrow(
      'Configured OpenAPI source escapes the project',
    )
  })

  it('rejects symlinked OpenAPI sources', () => {
    const projectRoot = createProject('openapi.yaml')
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'thally-external-openapi-'))
    projectRoots.push(externalRoot)
    const targetPath = path.join(externalRoot, 'openapi.yaml')
    writeFileSync(targetPath, 'openapi: 3.1.0\n')
    symlinkSync(targetPath, path.join(projectRoot, 'openapi.yaml'))

    expect(() => collectRuntimeContentFiles(projectRoot)).toThrow(
      'Configured OpenAPI source is not a regular file',
    )
  })

  it('rejects OpenAPI sources beneath a symlinked directory', () => {
    const projectRoot = createProject('specs/openapi.yaml')
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'thally-external-specs-'))
    projectRoots.push(externalRoot)
    writeFileSync(path.join(externalRoot, 'openapi.yaml'), 'openapi: 3.1.0\n')
    symlinkSync(externalRoot, path.join(projectRoot, 'specs'))

    expect(() => collectRuntimeContentFiles(projectRoot)).toThrow(
      'Configured OpenAPI source resolves outside the project',
    )
  })
})
