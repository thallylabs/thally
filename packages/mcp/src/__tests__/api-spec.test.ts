/** Safe OpenAPI authoring tool coverage for the docs agent. */

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { handleReadApiSpec } from '../tools/read-api-spec.js'
import { handleUpdateApiSpec } from '../tools/update-api-spec.js'

const workspaces: Array<string> = []

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thally-api-tool-'))
  workspaces.push(directory)
  writeFileSync(
    join(directory, 'docs.json'),
    JSON.stringify({ tabs: [{ tab: 'API', api: { source: 'openapi.yaml' } }] }),
  )
  writeFileSync(join(directory, 'openapi.yaml'), 'openapi: 3.1.0\npaths: {}\n')
  return directory
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OpenAPI authoring tools', () => {
  it('reads and validates the one configured API source', async () => {
    const projectDir = project()

    await expect(handleReadApiSpec({ projectDir })).resolves.toContain('openapi: 3.1.0')
    await expect(
      handleUpdateApiSpec({
        projectDir,
        content: 'openapi: 3.1.0\npaths:\n  /v1/events:\n    get:\n      responses: {}\n',
      }),
    ).resolves.toContain('openapi.yaml')
    expect(readFileSync(join(projectDir, 'openapi.yaml'), 'utf8')).toContain('/v1/events')
  })

  it('rejects invalid documents and paths outside docs.json', async () => {
    const projectDir = project()

    await expect(handleUpdateApiSpec({ projectDir, content: 'not: openapi\n' })).rejects.toThrow(
      'openapi and paths',
    )
    await expect(
      handleUpdateApiSpec({
        projectDir,
        source: '../package.json',
        content: '{"openapi":"3.1.0","paths":{}}',
      }),
    ).rejects.toThrow('repository-relative')
  })

  it('refuses a configured symlink instead of writing outside the project', async () => {
    const projectDir = project()
    const outside = `${projectDir}-outside-openapi.yaml`
    writeFileSync(outside, 'openapi: 3.1.0\npaths: {}\n')
    rmSync(join(projectDir, 'openapi.yaml'))
    symlinkSync(outside, join(projectDir, 'openapi.yaml'))

    await expect(handleReadApiSpec({ projectDir })).rejects.toThrow('regular file inside')
    await expect(
      handleUpdateApiSpec({
        projectDir,
        content: 'openapi: 3.1.0\npaths: {}\n',
      }),
    ).rejects.toThrow('regular file inside')
    rmSync(outside, { force: true })
  })
})
