/** Contract tests for the GitLab CI receiver and sender templates. */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { parseRepositoryReference, resolveGitHosts } from '@thallylabs/mcp/track'

import {
  buildDocsAgentGitlabPipeline,
  DOCS_AGENT_GITLAB_PIPELINE,
  DOCS_AGENT_GITLAB_PIPELINE_PATH,
  DOCS_AGENT_WORKFLOW,
  scaffoldAgentWorkflow,
  trackSenderGitlabJobs,
} from '../scaffold.js'

/** A parsed CI job: only the keys these tests read. */
interface CiJob {
  extends?: string
  stage?: string
  image?: { entrypoint?: Array<string> }
  id_tokens?: Record<string, { aud: string }>
  rules: Array<{ if: string; changes?: Array<string> }>
  script: Array<string>
  before_script: Array<string>
}

function loadYaml(text: string): Record<string, CiJob> {
  return parseYaml(text) as Record<string, CiJob>
}

const directories: Array<string> = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

const docsRef = parseRepositoryReference('https://gitlab.com/acme/platform/docs')!

describe('GitLab receiver pipeline', () => {
  it('is valid YAML with the contract marker and hardened job', () => {
    expect(DOCS_AGENT_GITLAB_PIPELINE.startsWith('# Contract: thally-track/v4 (gitlab)\n')).toBe(true)
    const pipeline = loadYaml(DOCS_AGENT_GITLAB_PIPELINE)
    const job = pipeline['thally-document']
    expect(job.extends).toBe('.thally-node')
    expect(job.id_tokens?.THALLY_OIDC_TOKEN.aud).toBe('thally-readiness-pr')
    expect(job.rules.map((rule: { if: string }) => rule.if).join('\n')).toContain('$THALLY_EVENT == "thally-document"')
    expect(pipeline['thally-drift-sweep'].rules[0].if).toContain('$CI_PIPELINE_SOURCE == "schedule"')
    const script = job.script[0] as string
    expect(script).toContain('/api/gitlab/readiness-pr')
    expect(script).not.toContain('/api/github/readiness-pr')
    expect(script).not.toContain('::add-mask::')
    expect(script).not.toContain('$THALLY_GITLAB_TOKEN@')
    // Variables are never interpolated into the YAML outside quoted shell use.
    expect(DOCS_AGENT_GITLAB_PIPELINE).not.toMatch(/variables:\n(?:\s+\S+: .*\n)*\s+INSTRUCTION:/)
  })

  it('changes into a monorepo docs root and rejects traversal', () => {
    const pipeline = loadYaml(buildDocsAgentGitlabPipeline({ docsRootDir: '/apps/docs/' }))
    expect(pipeline['.thally-node'].before_script[0]).toBe('cd "apps/docs"')
    expect(() => buildDocsAgentGitlabPipeline({ docsRootDir: 'apps/../..' })).toThrow('repository-relative')
  })

  it('leaves the GitHub receiver untouched', () => {
    expect(DOCS_AGENT_WORKFLOW).toContain('repository_dispatch:')
    expect(DOCS_AGENT_WORKFLOW).not.toContain('gitlab')
  })
})

describe('GitLab Track sender jobs', () => {
  it('dispatches preview and merged changes with loop guards', () => {
    const yaml = trackSenderGitlabJobs(docsRef, { owner: 'acme', repo: 'api', provider: 'gitlab', paths: ['src/**', 'openapi.yaml'] })
    const jobs = loadYaml(yaml)
    const base = jobs['.thally-track-dispatch']
    expect(base.stage).toBe('.post')
    expect(base.image?.entrypoint).toEqual([''])
    expect(base.script[0]).toContain('"https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fdocs/trigger/pipeline"')
    expect(base.script[0]).toContain('--form-string "variables[INSTRUCTION]=$INSTRUCTION"')
    expect(base.script[0]).not.toMatch(/ -F /)

    const preview = jobs['thally-track-preview']
    expect(preview.rules[0].if).toContain('$CI_MERGE_REQUEST_LABELS =~ /(^|,)docs-preview(,|$)/')
    expect(preview.rules[0].if).toContain('!~ /^(thally\\/agent-|thally\\/track-vnext\\/)/')
    expect(preview.rules[0].changes).toEqual(['src/**/*', 'openapi.yaml'])
    expect(preview.before_script[0]).toContain('(!${CI_MERGE_REQUEST_IID})')
    expect(preview.before_script[0]).toContain('THALLY_FROM_PR="$CI_MERGE_REQUEST_PROJECT_URL/-/merge_requests/$CI_MERGE_REQUEST_IID"')

    const merged = jobs['thally-track-merged']
    expect(merged.rules[0].if).toBe('$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"')
    expect(merged.before_script[0]).toContain('(merge commit ${CI_COMMIT_SHORT_SHA})')
    expect(merged.before_script[0]).toContain('THALLY_FROM_PR="$CI_PROJECT_URL/-/commit/$CI_COMMIT_SHA"')
    expect(yaml).not.toContain('$CI_MERGE_REQUEST_TITLE')
  })

  it('escapes hostile tracking values and rejects unsafe branches', () => {
    const yaml = trackSenderGitlabJobs(docsRef, {
      owner: 'acme',
      repo: 'api',
      branch: 'main"; rm -rf /',
      outputTab: 'Tab "$(touch x)" `y` \\z',
    })
    const jobs = loadYaml(yaml)
    expect(jobs['thally-track-merged'].rules[0].if).toContain('$CI_COMMIT_BRANCH == "main"')
    const script = jobs['thally-track-merged'].before_script[0] as string
    expect(script).toContain('Tab \\"\\$(touch x)\\" \\`y\\` \\\\z')

    // Run the generated assignment in a shell: the hostile value stays literal.
    const directory = tempDir('thally-gitlab-sender-')
    const result = spawnSync('sh', ['-c', `${script}\nprintf '%s' "$INSTRUCTION"`], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, CI_COMMIT_SHORT_SHA: 'abc1234', CI_PROJECT_URL: 'u', CI_COMMIT_SHA: 'abc' },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Tab "$(touch x)" `y` \\z')
    expect(result.stdout).toContain('(merge commit abc1234)')
    expect(existsSync(join(directory, 'x'))).toBe(false)
  })

  it('targets self-hosted docs projects through their API base', () => {
    const selfHosted = parseRepositoryReference('https://git.example.com/docs/site', {
      hosts: resolveGitHosts([{ host: 'git.example.com', provider: 'gitlab' }]),
    })!
    expect(trackSenderGitlabJobs(selfHosted, { owner: 'a', repo: 'b' })).toContain(
      '"https://git.example.com/api/v4/projects/docs%2Fsite/trigger/pipeline"',
    )
  })
})

describe('GitLab receiver runtime handoff', () => {
  it('passes pipeline variables to the CLI without evaluating them as shell', () => {
    const directory = tempDir('thally-gitlab-runtime-')
    const bin = join(directory, 'bin')
    const thallyBin = join(directory, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    mkdirSync(thallyBin, { recursive: true })
    const argsPath = join(directory, 'args')
    const contextCopy = join(directory, 'context-copy')
    const injected = join(directory, 'injected')
    // git is stubbed: the receiver only needs `checkout -B` to succeed here.
    writeExecutable(join(bin, 'git'), '#!/usr/bin/env bash\nexit 0\n')
    writeExecutable(
      join(thallyBin, 'thally'),
      `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > "$CAPTURE_ARGS"\nprintf '%s' "$THALLY_GITLAB_TOKEN|$THALLY_GIT_HOSTS" > "$CAPTURE_ARGS.env"\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--context-file" ]; then cp "$2" "$CAPTURE_CONTEXT"; break; fi\n  shift\ndone\n`,
    )

    const pipeline = loadYaml(DOCS_AGENT_GITLAB_PIPELINE)
    const script = pipeline['thally-document'].script[0] as string
    const instruction = `Document export; touch ${injected}; $(touch ${injected})`
    const context = `# MR context\n\`$(touch ${injected})\``
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        HOME: directory,
        CAPTURE_ARGS: argsPath,
        CAPTURE_CONTEXT: contextCopy,
        CI_COMMIT_REF_NAME: 'main',
        CI_SERVER_HOST: 'git.example.com',
        THALLY_AGENT_TOKEN: 'project-token',
        INSTRUCTION: instruction,
        FROM_PR: 'https://git.example.com/acme/api/-/merge_requests/4',
        TRACK_CONTEXT: context,
        REQUESTER: 'ada; touch should-not-run',
      },
      timeout: 60_000,
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(injected)).toBe(false)
    expect(readFileSync(contextCopy, 'utf8')).toBe(context)
    const args = readFileSync(argsPath, 'utf8').split('\0').filter(Boolean)
    expect(args.slice(0, 4)).toEqual(['agent', instruction, '--from-pr', 'https://git.example.com/acme/api/-/merge_requests/4'])
    expect(args[4]).toBe('--context-file')
    expect(args.slice(6)).toEqual(['--requester', 'ada; touch should-not-run', '--pr'])
    expect(readFileSync(`${argsPath}.env`, 'utf8')).toBe('project-token|git.example.com=gitlab')
  })

  it('expands empty optional argument arrays under set -u', () => {
    const pipeline = loadYaml(DOCS_AGENT_GITLAB_PIPELINE)
    expect(pipeline['thally-document'].script[0]).toContain('${REQUESTER_ARGS[@]+"${REQUESTER_ARGS[@]}"}')
  })

  it('exits cleanly when no instruction was provided', () => {
    const directory = tempDir('thally-gitlab-noop-')
    const pipeline = loadYaml(DOCS_AGENT_GITLAB_PIPELINE)
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', pipeline['thally-document'].script[0]], {
      cwd: directory,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('nothing to do')
  })
})

describe('scaffoldAgentWorkflow for GitLab', () => {
  it('creates the receiver, a root include, and CODEOWNERS', () => {
    const directory = tempDir('thally-gitlab-init-')
    const result = scaffoldAgentWorkflow(directory, 'acme/platform/docs', { provider: 'gitlab' })
    expect(result.provider).toBe('gitlab')
    expect(result.written.sort()).toEqual(['.gitlab-ci.yml', '.gitlab/CODEOWNERS', DOCS_AGENT_GITLAB_PIPELINE_PATH].sort())
    expect(readFileSync(join(directory, '.gitlab-ci.yml'), 'utf8')).toContain(`- local: ${DOCS_AGENT_GITLAB_PIPELINE_PATH}`)
    expect(result.senderSnippet).toContain('acme%2Fplatform%2Fdocs/trigger/pipeline')
    expect(result.notes).toEqual([])
  })

  it('never rewrites an existing .gitlab-ci.yml', () => {
    const directory = tempDir('thally-gitlab-existing-')
    writeFileSync(join(directory, '.gitlab-ci.yml'), 'test:\n  script: [echo hi]\n')
    const result = scaffoldAgentWorkflow(directory, 'acme/docs', { provider: 'gitlab' })
    expect(readFileSync(join(directory, '.gitlab-ci.yml'), 'utf8')).toBe('test:\n  script: [echo hi]\n')
    expect(result.written).not.toContain('.gitlab-ci.yml')
    expect(result.notes[0]).toContain(`- local: ${DOCS_AGENT_GITLAB_PIPELINE_PATH}`)
  })

  it('keeps the GitHub scaffold as the default', () => {
    const directory = tempDir('thally-github-init-')
    const result = scaffoldAgentWorkflow(directory, 'acme/docs')
    expect(result.provider).toBe('github')
    expect(readFileSync(join(directory, '.github', 'workflows', 'thally-agent.yml'), 'utf8')).toBe(DOCS_AGENT_WORKFLOW)
  })
})

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content)
  chmodSync(path, 0o700)
}
