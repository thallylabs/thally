/** Regression fixtures for graph-derived npm release selection. */

import assert from 'node:assert/strict'
import test from 'node:test'

import { planPackageRelease } from './release-package-plan.mjs'

const packageDefinitions = [
  ['core', '@thallylabs/core', {}],
  ['migrate', '@thallylabs/migrate', {}],
  ['create-thally-docs', 'create-thally-docs', { '@thallylabs/migrate': '1.0.0' }],
  ['mcp', '@thallylabs/mcp', { 'create-thally-docs': '1.0.0' }],
  ['cli', '@thallylabs/cli', { 'create-thally-docs': '1.0.0', '@thallylabs/mcp': '1.0.0' }],
  ['agent', '@thallylabs/agent', { '@thallylabs/mcp': '*' }],
]

function packages() {
  return packageDefinitions.map(([directory, name, dependencies]) => ({
    workspace: `packages/${directory}`,
    manifest: {
      name,
      version: '1.0.0',
      dependencies: { ...dependencies },
      ...(directory === 'agent' ? { private: true } : {}),
    },
  }))
}

function lockfile(currentPackages) {
  const entries = {}
  for (const { workspace, manifest } of currentPackages) {
    entries[workspace] = {
      version: manifest.version,
      dependencies: { ...manifest.dependencies },
    }
    entries[`node_modules/${manifest.name}`] = { resolved: workspace, link: true }
  }
  return { packages: entries }
}

function fixture(changedDirectories, { bump = true, refreshLock = true } = {}) {
  const previousPackages = packages()
  const currentPackages = packages()
  const names = new Set(changedDirectories.map((directory) => `packages/${directory}`))
  for (const { workspace, manifest } of currentPackages) {
    if (names.has(workspace) && bump) manifest.version = '1.0.1'
  }
  for (const { manifest } of currentPackages) {
    if (manifest.private) continue
    for (const entry of currentPackages) {
      if (names.has(entry.workspace) && manifest.dependencies[entry.manifest.name]) {
        manifest.dependencies[entry.manifest.name] = entry.manifest.version
      }
    }
  }
  return {
    previousPackages,
    currentPackages,
    changedPaths: changedDirectories.map((directory) => `packages/${directory}/src/index.ts`),
    lockfile: lockfile(refreshLock ? currentPackages : previousPackages),
  }
}

const selectedNames = (plan) => plan.packages.map((entry) => entry.name)

test('publishes only a changed independent Core package', () => {
  assert.deepEqual(selectedNames(planPackageRelease(fixture(['core']))), ['@thallylabs/core'])
})

test('orders a migrate source change before its exact-version dependent chain', () => {
  assert.deepEqual(selectedNames(planPackageRelease(fixture(['migrate', 'create-thally-docs', 'mcp', 'cli']))), [
    '@thallylabs/migrate',
    'create-thally-docs',
    '@thallylabs/mcp',
    '@thallylabs/cli',
  ])
})

test('derives create, MCP, and CLI dispositions from each dependency edge', () => {
  assert.deepEqual(selectedNames(planPackageRelease(fixture(['create-thally-docs', 'mcp', 'cli']))), [
    'create-thally-docs', '@thallylabs/mcp', '@thallylabs/cli',
  ])
  assert.deepEqual(selectedNames(planPackageRelease(fixture(['mcp', 'cli']))), [
    '@thallylabs/mcp', '@thallylabs/cli',
  ])
  assert.deepEqual(selectedNames(planPackageRelease(fixture(['cli']))), ['@thallylabs/cli'])
})

test('cross-package changes retain deterministic dependency-first order', () => {
  assert.deepEqual(selectedNames(planPackageRelease(fixture(['core', 'migrate', 'create-thally-docs', 'mcp', 'cli']))), [
    '@thallylabs/core', '@thallylabs/migrate', 'create-thally-docs', '@thallylabs/mcp', '@thallylabs/cli',
  ])
})

test('unchanged and private workspaces have explicit non-publish dispositions', () => {
  const plan = planPackageRelease(fixture(['agent']))
  assert.deepEqual(plan.packages, [])
  assert.equal(plan.dispositions.find((entry) => entry.name === '@thallylabs/agent').disposition, 'nonpublishable')
  assert.equal(plan.dispositions.find((entry) => entry.name === '@thallylabs/core').disposition, 'unchanged')
})

test('fails a missing version bump, stale dependent range, or stale lockfile', () => {
  assert.throws(() => planPackageRelease(fixture(['cli'], { bump: false })), /without a newer package version/)
  const staleRange = fixture(['migrate'])
  staleRange.currentPackages.find((entry) => entry.workspace === 'packages/create-thally-docs')
    .manifest.dependencies['@thallylabs/migrate'] = '1.0.0'
  staleRange.lockfile = lockfile(staleRange.currentPackages)
  assert.throws(() => planPackageRelease(staleRange), /must pin @thallylabs\/migrate@1\.0\.1/)
  assert.throws(() => planPackageRelease(fixture(['cli'], { refreshLock: false })), /root package lockfile/)
})
