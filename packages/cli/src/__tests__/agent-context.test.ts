/** Regression coverage for Cloud Track's pre-resolved context handoff. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readTrackContextFile } from '../commands/agent.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('readTrackContextFile', () => {
  it('preserves multiline PR context without shell interpretation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'thally-track-context-'))
    directories.push(directory)
    const path = join(directory, 'context.md')
    const context = '# PR\n\n`$(touch should-not-run)`\n${{ github.token }}\n'
    writeFileSync(path, context)
    expect(readTrackContextFile(path)).toBe(context)
  })

  it('caps oversized context before it reaches the model', () => {
    const directory = mkdtempSync(join(tmpdir(), 'thally-track-context-'))
    directories.push(directory)
    const path = join(directory, 'context.md')
    writeFileSync(path, 'x'.repeat(50_000))
    expect(readTrackContextFile(path)).toHaveLength(40_000)
  })
})
