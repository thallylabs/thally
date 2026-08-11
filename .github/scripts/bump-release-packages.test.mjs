/**
 * Regression coverage for atomic release-package version updates.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { bumpReleasePackages } from './bump-release-packages.mjs'

function writePackage(rootDirectory, packagePath, manifest) {
  const absolutePath = join(rootDirectory, packagePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function readPackage(rootDirectory, packagePath) {
  return JSON.parse(readFileSync(join(rootDirectory, packagePath), 'utf8'))
}

test('bumps the package chain before repinning internal dependencies', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'thally-release-packages-'))
  try {
    writePackage(rootDirectory, 'packages/create-thally-docs/package.json', {
      name: 'create-thally-docs',
      version: '0.10.5',
    })
    writePackage(rootDirectory, 'packages/mcp/package.json', {
      name: '@thallylabs/mcp',
      version: '0.10.5',
      dependencies: { 'create-thally-docs': '0.10.5' },
    })
    writePackage(rootDirectory, 'packages/cli/package.json', {
      name: '@thallylabs/cli',
      version: '0.8.5',
      dependencies: {
        'create-thally-docs': '0.10.5',
        '@thallylabs/mcp': '0.10.5',
      },
    })

    assert.deepEqual(bumpReleasePackages(rootDirectory), {
      create: '0.10.6',
      mcp: '0.10.6',
      cli: '0.8.6',
    })
    assert.equal(
      readPackage(rootDirectory, 'packages/mcp/package.json').dependencies['create-thally-docs'],
      '0.10.6',
    )
    assert.deepEqual(
      readPackage(rootDirectory, 'packages/cli/package.json').dependencies,
      {
        'create-thally-docs': '0.10.6',
        '@thallylabs/mcp': '0.10.6',
      },
    )
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true })
  }
})

test('rejects prerelease versions before changing any manifest', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'thally-release-packages-'))
  try {
    const manifests = [
      ['packages/create-thally-docs/package.json', { name: 'create-thally-docs', version: '0.10.5' }],
      [
        'packages/mcp/package.json',
        {
          name: '@thallylabs/mcp',
          version: '0.10.6-next.1',
          dependencies: { 'create-thally-docs': '0.10.5' },
        },
      ],
      [
        'packages/cli/package.json',
        {
          name: '@thallylabs/cli',
          version: '0.8.5',
          dependencies: {
            'create-thally-docs': '0.10.5',
            '@thallylabs/mcp': '0.10.5',
          },
        },
      ],
    ]
    for (const [packagePath, manifest] of manifests) {
      writePackage(rootDirectory, packagePath, manifest)
    }

    assert.throws(() => bumpReleasePackages(rootDirectory), /stable semantic version/)
    assert.equal(
      readPackage(rootDirectory, 'packages/create-thally-docs/package.json').version,
      '0.10.5',
    )
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true })
  }
})
