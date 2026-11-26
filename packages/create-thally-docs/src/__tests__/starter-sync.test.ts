/** Three-way starter ownership and update-safety regression coverage. */

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  statSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  STABLE_SCAFFOLD_RELEASE,
  type ScaffoldOwnershipContract,
  type ScaffoldRelease,
  type StarterReleaseManifest,
} from '../release.js'
import {
  applyStarterRuntimeSyncPlan,
  classifyStarterPath,
  parseStarterOwnershipContract,
  parseStarterReleaseManifest,
  planStarterRuntimeSync,
  readStarterReleaseManifest,
  starterManifestSha256,
} from '../starter-sync.js'

const directories: string[] = []

const OWNERSHIP: ScaffoldOwnershipContract = {
  frameworkSyncEligible: [
    'src/components/**',
    'src/mdx/**',
    'snippets/**',
  ],
  userOwnedNeverOverwrite: [
    'src/mdx/custom-components.tsx',
    'snippets/**',
    '.env*',
  ],
  manualReview: ['package.json'],
}

function directory(prefix: string): string {
  const result = mkdtempSync(join(tmpdir(), prefix))
  directories.push(result)
  return result
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function manifestSource(): string {
  const manifest: StarterReleaseManifest = {
    schemaVersion: 1,
    starterVersion: STABLE_SCAFFOLD_RELEASE.starterVersion,
    repository: STABLE_SCAFFOLD_RELEASE.source.repository,
    defaultBranch: 'main',
    runtime: {
      repository: STABLE_SCAFFOLD_RELEASE.runtime.repository,
      commitSha: STABLE_SCAFFOLD_RELEASE.runtime.commitSha,
      treeSha: STABLE_SCAFFOLD_RELEASE.runtime.treeSha,
    },
    packages: {
      '@thallylabs/cli': '0.7.0',
      '@thallylabs/mcp': '0.9.0',
    },
    ownership: OWNERSHIP,
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function releaseForManifest(source: string): ScaffoldRelease {
  return {
    ...STABLE_SCAFFOLD_RELEASE,
    source: {
      ...STABLE_SCAFFOLD_RELEASE.source,
      manifestSha256: starterManifestSha256(source),
    },
  }
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('starter-release.json validation', () => {
  it('binds ownership to the promoted manifest hash and runtime identity', () => {
    const source = manifestSource()
    const release = releaseForManifest(source)

    expect(parseStarterReleaseManifest(source, release)).toMatchObject({
      repository: 'thallylabs/starter',
      runtime: {
        repository: STABLE_SCAFFOLD_RELEASE.runtime.repository,
        commitSha: STABLE_SCAFFOLD_RELEASE.runtime.commitSha,
      },
      ownership: OWNERSHIP,
    })

    expect(() => parseStarterReleaseManifest(`${source} `, release)).toThrow(
      'promoted SHA-256',
    )
    const wrongRuntime = source.replace(
      STABLE_SCAFFOLD_RELEASE.runtime.commitSha,
      'f'.repeat(40),
    )
    const wrongRuntimeRelease = releaseForManifest(wrongRuntime)
    expect(() =>
      parseStarterReleaseManifest(wrongRuntime, wrongRuntimeRelease),
    ).toThrow('identity does not match')
  })

  it('accepts exact, directory, and terminal filename-prefix rules only', () => {
    expect(parseStarterOwnershipContract(OWNERSHIP)).toEqual(OWNERSHIP)
    expect(() =>
      parseStarterOwnershipContract({
        ...OWNERSHIP,
        frameworkSyncEligible: ['src/**/route.ts'],
      }),
    ).toThrow('invalid frameworkSyncEligible')
    expect(() =>
      parseStarterOwnershipContract({
        ...OWNERSHIP,
        userOwnedNeverOverwrite: ['../docs.json'],
      }),
    ).toThrow('invalid userOwnedNeverOverwrite')
  })

  it('checks manifest package pins against the extracted package.json', () => {
    const source = manifestSource()
    const release = releaseForManifest(source)
    const starter = directory('thally-manifest-packages-')
    write(starter, release.source.manifestPath, source)
    write(
      starter,
      'package.json',
      JSON.stringify({
        dependencies: {
          '@thallylabs/cli': '0.7.0',
          '@thallylabs/mcp': '0.8.0',
        },
      }),
    )

    expect(() => readStarterReleaseManifest(starter, release)).toThrow(
      'package @thallylabs/mcp does not match',
    )
  })
})

describe('ownership precedence', () => {
  it('always protects custom components, snippets, and environment variants', () => {
    expect(classifyStarterPath('src/mdx/rehype.ts', OWNERSHIP)).toBe('syncable')
    expect(
      classifyStarterPath('src/mdx/custom-components.tsx', OWNERSHIP),
    ).toBe('protected')
    expect(classifyStarterPath('snippets/example.mdx', OWNERSHIP)).toBe(
      'protected',
    )
    expect(classifyStarterPath('.env.production.local', OWNERSHIP)).toBe(
      'protected',
    )
    expect(classifyStarterPath('package.json', OWNERSHIP)).toBe('manual')
  })
})

describe('three-way starter runtime planning', () => {
  function mergeFixture() {
    const old = directory('thally-merge-old-'), next = directory('thally-merge-next-'), target = directory('thally-merge-local-')
    write(old, 'src/components/runtime.tsx', 'first\nmiddle\nlast\n')
    write(target, 'src/components/runtime.tsx', 'local\nmiddle\nlast\n')
    write(next, 'src/components/runtime.tsx', 'first\nmiddle\nupstream\n')
    return { old, next, target }
  }

  it('plans merged bytes as copy paths and preserves upstream modes on apply', () => {
    const { old, next, target } = mergeFixture()
    chmodSync(join(next, 'src/components/runtime.tsx'), 0o755)
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    expect(plan.copyPaths).toEqual(['src/components/runtime.tsx'])
    expect(plan.conflictPaths).toEqual([])
    expect(plan.mergedContents).toEqual({ 'src/components/runtime.tsx': 'local\nmiddle\nupstream\n' })
    // Plans cross the CLI/managed boundary as ordinary JSON, not hidden state.
    applyStarterRuntimeSyncPlan(next, target, JSON.parse(JSON.stringify(plan)), OWNERSHIP, { confirmed: true })
    expect(readFileSync(join(target, 'src/components/runtime.tsx'), 'utf8')).toBe('local\nmiddle\nupstream\n')
    expect(statSync(join(target, 'src/components/runtime.tsx')).mode & 0o777).toBe(0o755)
  })

  it('restores merged source, deletions, modes and provenance after mid-apply failure', () => {
    const { old, next, target } = mergeFixture()
    for (const root of [old, target]) write(root, 'src/components/delete.ts', 'delete me\n')
    write(target, 'starter-release.json', 'old provenance\n')
    write(next, 'starter-release.json', 'new provenance\n')
    chmodSync(join(target, 'src/components/runtime.tsx'), 0o740)
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    expect(() => applyStarterRuntimeSyncPlan(next, target, plan, OWNERSHIP, {
      confirmed: true,
      provenance: { sourcePath: join(next, 'starter-release.json'), targetPath: join(target, 'starter-release.json'), expectedSha256: starterManifestSha256('old provenance\n') },
      onMutationApplied(path) { if (path === 'starter-release.json') throw new Error('injected rollback') },
    })).toThrow('injected rollback')
    expect(readFileSync(join(target, 'src/components/runtime.tsx'), 'utf8')).toBe('local\nmiddle\nlast\n')
    expect(statSync(join(target, 'src/components/runtime.tsx')).mode & 0o777).toBe(0o740)
    expect(readFileSync(join(target, 'src/components/delete.ts'), 'utf8')).toBe('delete me\n')
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe('old provenance\n')
  })

  it('rejects even a line-ending-only local race without applying other work', () => {
    const { old, next, target } = mergeFixture()
    write(next, 'src/components/add.ts', 'new file\n')
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    write(target, 'src/components/runtime.tsx', 'local\r\nmiddle\r\nlast\r\n')
    let mutations = 0
    expect(() => applyStarterRuntimeSyncPlan(next, target, plan, OWNERSHIP, { confirmed: true, onMutationApplied() { mutations += 1 } })).toThrow('changed')
    expect(mutations).toBe(0)
    expect(plan.mergedContents?.['src/components/runtime.tsx']).toBe('local\nmiddle\nupstream\n')
  })

  it('binds merged preconditions to the input snapshot during planning', () => {
    const { old, next, target } = mergeFixture()
    let calls = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls += 1
      if (calls === 2) write(target, 'src/components/runtime.tsx', 'concurrent local edit\n')
      return 0
    })
    try {
      const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
      expect(plan.mergedContents?.['src/components/runtime.tsx']).toBe('local\nmiddle\nupstream\n')
      expect(() => applyStarterRuntimeSyncPlan(next, target, plan, OWNERSHIP, { confirmed: true })).toThrow('changed')
      expect(readFileSync(join(target, 'src/components/runtime.tsx'), 'utf8')).toBe('concurrent local edit\n')
    } finally { clock.mockRestore() }
  })

  it('keeps deletion/change and new-file collisions in conflict', () => {
    const { old, next, target } = mergeFixture()
    rmSync(join(next, 'src/components/runtime.tsx'))
    write(target, 'src/components/add.ts', 'local addition\n')
    write(next, 'src/components/add.ts', 'upstream addition\n')
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    expect(plan.conflictPaths).toEqual(['src/components/add.ts', 'src/components/runtime.tsx'])
    expect(plan.mergedContents).toBeUndefined()
  })

  it('limits aggregate source merge attempts per plan', () => {
    const old = directory('thally-bounded-old-'), next = directory('thally-bounded-next-'), target = directory('thally-bounded-local-')
    for (let i = 0; i < 9; i++) {
      const path = `src/components/file${i}.ts`
      write(old, path, 'a\nb\nc\n'); write(target, path, 'A\nb\nc\n'); write(next, path, 'a\nb\nC\n')
    }
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    expect(Object.keys(plan.mergedContents ?? {})).toHaveLength(8)
    expect(plan.conflictPaths).toEqual(['src/components/file8.ts'])
    expect(() => applyStarterRuntimeSyncPlan(next, target, plan, OWNERSHIP, { confirmed: true })).toThrow('conflicts')
  })

  it('does not let broadened ownership merge reserved output or metadata', () => {
    const old = directory('thally-reserved-old-'), next = directory('thally-reserved-next-'), target = directory('thally-reserved-local-')
    const reserved = ['.thally/output.ts', 'src/generated/output.ts', 'src/lib/agent-identity.ts', 'src/metadata.json', 'starter-release.json', 'src/data/site.ts', 'next.config.ts']
    for (const path of reserved) {
      write(old, path, 'a\nb\nc\n'); write(target, path, 'A\nb\nc\n'); write(next, path, 'a\nb\nC\n')
    }
    const plan = planStarterRuntimeSync(old, next, target, { frameworkSyncEligible: reserved, userOwnedNeverOverwrite: ['owner/**'], manualReview: [] })
    expect(plan.conflictPaths).toEqual([...reserved].sort())
    expect(plan.mergedContents).toBeUndefined()
  })

  it('upgrades unchanged files, adds new files, and preserves customer additions', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    for (const root of [oldStarter, target]) {
      write(root, 'src/components/runtime.tsx', 'old runtime\n')
    }
    write(newStarter, 'src/components/runtime.tsx', 'new runtime\n')
    write(newStarter, 'src/components/new-runtime.tsx', 'new file\n')
    write(target, 'src/components/app/customer.tsx', 'customer addition\n')

    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )

    expect(plan.copyPaths).toEqual([
      'src/components/new-runtime.tsx',
      'src/components/runtime.tsx',
    ])
    expect(plan.preservedPaths).toContain('src/components/app/customer.tsx')
    expect(plan.conflictPaths).toEqual([])
  })

  it('reports a conflict when both customer and upstream changed a framework file', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    write(oldStarter, 'src/components/runtime.tsx', 'old runtime\n')
    write(newStarter, 'src/components/runtime.tsx', 'upstream change\n')
    write(target, 'src/components/runtime.tsx', 'customer change\n')

    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )

    expect(plan.conflictPaths).toEqual(['src/components/runtime.tsx'])
    expect(() =>
      applyStarterRuntimeSyncPlan(
        newStarter,
        target,
        plan,
        OWNERSHIP,
        { confirmed: true },
      ),
    ).toThrow('Resolve starter synchronization conflicts')
    expect(readFileSync(join(target, 'src/components/runtime.tsx'), 'utf8')).toBe(
      'customer change\n',
    )
  })

  it('preserves a customer modification when upstream did not change it', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    write(oldStarter, 'src/components/runtime.tsx', 'same runtime\n')
    write(newStarter, 'src/components/runtime.tsx', 'same runtime\n')
    write(target, 'src/components/runtime.tsx', 'customer change\n')

    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )

    expect(plan.conflictPaths).toEqual([])
    expect(plan.preservedPaths).toEqual(['src/components/runtime.tsx'])
    expect(plan.copyPaths).toEqual([])
  })

  it('never plans protected files and reports manual-review files separately', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    for (const root of [oldStarter, target]) {
      write(root, 'src/mdx/custom-components.tsx', 'customer component\n')
      write(root, 'snippets/example.mdx', 'customer snippet\n')
      write(root, 'package.json', '{"name":"customer"}\n')
    }
    write(newStarter, 'src/mdx/custom-components.tsx', 'starter replacement\n')
    write(newStarter, 'snippets/example.mdx', 'starter replacement\n')
    write(newStarter, 'package.json', '{"name":"starter"}\n')

    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )

    expect(plan.copyPaths).toEqual([])
    expect(plan.deletePaths).toEqual([])
    expect(plan.conflictPaths).toEqual([])
    expect(plan.manualReviewPaths).toEqual(['package.json'])
  })

  it('applies only a confirmed, conflict-free plan', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    write(oldStarter, 'src/components/runtime.tsx', 'old runtime\n')
    write(oldStarter, 'src/components/removed.tsx', 'remove me\n')
    write(target, 'src/components/runtime.tsx', 'old runtime\n')
    write(target, 'src/components/removed.tsx', 'remove me\n')
    write(newStarter, 'src/components/runtime.tsx', 'new runtime\n')
    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )

    expect(() =>
      applyStarterRuntimeSyncPlan(
        newStarter,
        target,
        plan,
        OWNERSHIP,
        { confirmed: false },
      ),
    ).toThrow('Review and confirm')

    applyStarterRuntimeSyncPlan(
      newStarter,
      target,
      plan,
      OWNERSHIP,
      { confirmed: true },
    )
    expect(readFileSync(join(target, 'src/components/runtime.tsx'), 'utf8')).toBe(
      'new runtime\n',
    )
    expect(() =>
      readFileSync(join(target, 'src/components/removed.tsx'), 'utf8'),
    ).toThrow()
  })

  it('refuses a target changed after planning before mutating any file', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    for (const path of ['src/components/a.tsx', 'src/components/b.tsx']) {
      write(oldStarter, path, `old ${path}\n`)
      write(target, path, `old ${path}\n`)
      write(newStarter, path, `new ${path}\n`)
    }
    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )
    write(target, 'src/components/b.tsx', 'concurrent customer edit\n')

    expect(() => applyStarterRuntimeSyncPlan(
      newStarter,
      target,
      plan,
      OWNERSHIP,
      { confirmed: true },
    )).toThrow('target changed after planning')
    expect(readFileSync(join(target, 'src/components/a.tsx'), 'utf8')).toBe(
      'old src/components/a.tsx\n',
    )
    expect(readFileSync(join(target, 'src/components/b.tsx'), 'utf8')).toBe(
      'concurrent customer edit\n',
    )
  })

  it('rolls back files and provenance after an injected mid-apply failure', () => {
    const oldStarter = directory('thally-old-starter-')
    const newStarter = directory('thally-new-starter-')
    const target = directory('thally-current-site-')
    for (const path of ['src/components/a.tsx', 'src/components/b.tsx']) {
      write(oldStarter, path, `old ${path}\n`)
      write(target, path, `old ${path}\n`)
      write(newStarter, path, `new ${path}\n`)
    }
    const oldManifest = '{"starterVersion":1}\n'
    const newManifest = '{"starterVersion":2}\n'
    write(target, 'starter-release.json', oldManifest)
    write(newStarter, 'starter-release.json', newManifest)
    const plan = planStarterRuntimeSync(
      oldStarter,
      newStarter,
      target,
      OWNERSHIP,
    )

    expect(() => applyStarterRuntimeSyncPlan(
      newStarter,
      target,
      plan,
      OWNERSHIP,
      {
        confirmed: true,
        provenance: {
          sourcePath: join(newStarter, 'starter-release.json'),
          targetPath: join(target, 'starter-release.json'),
          expectedSha256: starterManifestSha256(oldManifest),
        },
        onMutationApplied(path) {
          if (path === 'starter-release.json') {
            throw new Error('injected apply failure')
          }
        },
      },
    )).toThrow('injected apply failure')
    expect(readFileSync(join(target, 'src/components/a.tsx'), 'utf8')).toBe(
      'old src/components/a.tsx\n',
    )
    expect(readFileSync(join(target, 'src/components/b.tsx'), 'utf8')).toBe(
      'old src/components/b.tsx\n',
    )
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe(
      oldManifest,
    )
  })
})

describe('atomic owner-reviewed configuration updates', () => {
  it('rolls back framework, merged configuration, and provenance together after a failure', () => {
    const old = directory('thally-manual-old-')
    const next = directory('thally-manual-next-')
    const target = directory('thally-manual-target-')
    for (const root of [old, target]) {
      write(root, 'src/components/runtime.ts', 'old runtime')
      write(root, 'package.json', '{"name":"customer","version":"1"}')
      write(root, 'starter-release.json', 'old provenance')
    }
    write(next, 'src/components/runtime.ts', 'next runtime')
    write(next, 'starter-release.json', 'next provenance')
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    const packageSource = readFileSync(join(target, 'package.json'))
    expect(() => applyStarterRuntimeSyncPlan(next, target, plan, OWNERSHIP, {
      confirmed: true,
      manualMutations: {
        writeFiles: new Map([['package.json', Buffer.from('{"name":"customer","version":"2"}')]]),
        deletePaths: [],
        targetPreconditions: { 'package.json': { kind: 'file', sha256: starterManifestSha256(packageSource.toString()) } },
      },
      provenance: { sourcePath: join(next, 'starter-release.json'), targetPath: join(target, 'starter-release.json'), expectedSha256: starterManifestSha256('old provenance') },
      onMutationApplied: (path) => { if (path === 'starter-release.json') throw new Error('failure after provenance') },
    })).toThrow('failure after provenance')
    expect(readFileSync(join(target, 'src/components/runtime.ts'), 'utf8')).toBe('old runtime')
    expect(readFileSync(join(target, 'package.json'))).toEqual(packageSource)
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe('old provenance')
  })
})

describe('Windows runtime checkout line endings', () => {
  it('updates unchanged CRLF text while keeping exact mutation preconditions', () => {
    const old = directory('thally-old-crlf-')
    const next = directory('thally-next-crlf-')
    const target = directory('thally-target-crlf-')
    write(old, 'src/components/card.tsx', 'export const version = 1\n')
    write(next, 'src/components/card.tsx', 'export const version = 2\n')
    write(target, 'src/components/card.tsx', 'export const version = 1\r\n')
    const plan = planStarterRuntimeSync(old, next, target, OWNERSHIP)
    expect(plan.copyPaths).toEqual(['src/components/card.tsx'])
    expect(plan.conflictPaths).toEqual([])
    // A change after planning still fails, even if it changes only line endings.
    write(target, 'src/components/card.tsx', 'export const version = 1\n')
    expect(() => applyStarterRuntimeSyncPlan(next, target, plan, OWNERSHIP, { confirmed: true })).toThrow('changed')
  })

  it('preserves substantive CRLF edits and binary differences as conflicts', () => {
    const old = directory('thally-old-edited-')
    const next = directory('thally-next-edited-')
    const target = directory('thally-target-edited-')
    for (const path of ['src/components/card.tsx', 'src/components/image.png']) {
      write(old, path, 'old\n')
      write(next, path, 'new\n')
      write(target, path, path.endsWith('.png') ? 'old\r\n' : 'owner edit\r\n')
    }
    expect(planStarterRuntimeSync(old, next, target, OWNERSHIP).conflictPaths)
      .toEqual(['src/components/card.tsx', 'src/components/image.png'])
  })
})
