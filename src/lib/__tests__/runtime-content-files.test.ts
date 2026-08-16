/** Regression coverage for authored files embedded into self-hosted runtimes. */

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectRuntimeContentFiles } from '../../../scripts/lib/runtime-content-files'

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
