/** `thally track` docs.json writes and setup output for GitHub and GitLab repositories. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs } from '../router.js'
import { runTrackCommand } from '../commands/track.js'

let projectDir: string
let previousCwd: string
let output: string

beforeEach(() => {
  previousCwd = process.cwd()
  projectDir = mkdtempSync(join(tmpdir(), 'thally-track-cli-'))
  writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ name: 'Docs', tabs: [] }))
  process.chdir(projectDir)
  output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output += String(chunk)
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(previousCwd)
  rmSync(projectDir, { recursive: true, force: true })
})

function track(...argv: Array<string>) {
  return runTrackCommand(parseArgs(['track', ...argv]))
}

function trackedRepos() {
  return JSON.parse(readFileSync(join(projectDir, 'docs.json'), 'utf8')).tracking.repos
}

describe('thally track add', () => {
  it('keeps GitHub entries in the original shape', async () => {
    expect(await track('add', 'acme/api', '--paths', 'src/**')).toBe(0)
    expect(trackedRepos()).toEqual([{ owner: 'acme', repo: 'api', paths: ['src/**'] }])
  })

  it('records GitLab namespaces, providers, and self-hosted hosts', async () => {
    await track('add', 'https://gitlab.com/acme/platform/api')
    await track('add', 'team/app', '--provider', 'gitlab', '--host', 'git.example.com', '--branch', 'develop')
    expect(trackedRepos()).toEqual([
      { owner: 'acme/platform', repo: 'api', provider: 'gitlab' },
      { owner: 'team', repo: 'app', provider: 'gitlab', host: 'git.example.com', branch: 'develop' },
    ])
    expect(output).toContain('gitlab:acme/platform/api@main')
    expect(output).toContain('git.example.com:team/app@develop')
  })

  it('keeps the same name on different providers distinct and upserts within one', async () => {
    await track('add', 'acme/api')
    await track('add', 'acme/api', '--provider', 'gitlab')
    await track('add', 'acme/api', '--provider', 'gitlab', '--tab', 'API')
    expect(trackedRepos()).toEqual([
      { owner: 'acme', repo: 'api' },
      { owner: 'acme', repo: 'api', provider: 'gitlab', outputTab: 'API' },
    ])
  })

  it('rejects an unknown provider', async () => {
    expect(await track('add', 'acme/api', '--provider', 'svn')).toBe(1)
    expect(output).toContain('Usage: thally track add')
  })
})

describe('thally track setup', () => {
  it('prints GitLab webhook steps and sender jobs for GitLab projects', async () => {
    await track('add', 'acme/platform/api', '--paths', 'src/**')
    output = ''
    expect(await track('setup', '--repo', 'acme/platform/docs', '--write')).toBe(0)
    expect(output).toContain('GitLab — Mode B')
    expect(output).toContain('Merge request events')
    expect(output).toContain('acme%2Fplatform%2Fdocs/trigger/pipeline')
    expect(output).not.toContain('GitHub — Mode A')
    expect(readFileSync(join(projectDir, 'thally-track-sender-api.gitlab-ci.yml'), 'utf8')).toContain('thally-track-merged:')
  })

  it('keeps the GitHub instructions for GitHub repositories', async () => {
    await track('add', 'acme/api')
    output = ''
    await track('setup', '--repo', 'acme/docs')
    expect(output).toContain('GitHub — Mode A: Connect GitHub app')
    expect(output).toContain('gh api repos/acme/docs/dispatches')
    expect(output).not.toContain('GitLab — Mode B')
  })
})
