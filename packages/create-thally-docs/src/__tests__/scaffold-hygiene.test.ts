import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shouldInclude } from '../download.js'
import { resetTrackingConfig, writeTrackingConfig } from '../docs-json.js'

// A scaffold must NOT inherit the Thally project's own project-specific wiring.
// These guards are the safety net: if a future template change re-introduces the
// Thally project's tracking/agent config into a scaffold, one of these fails.
describe('scaffold hygiene — Track/agent are opt-in, never inherited', () => {
  describe('download filter (shouldInclude)', () => {
    it('excludes the monorepo tooling and the opt-in Track/agent wiring', () => {
      // Tarball entries look like `thally-main/<path>`.
      expect(shouldInclude('thally-main/packages/mcp/src/lib/track.ts')).toBe(false)
      expect(shouldInclude('thally-main/cli/index.ts')).toBe(false)
      expect(shouldInclude('thally-main/.github/workflows/thally-agent.yml')).toBe(false)
      expect(shouldInclude('thally-main/.github/workflows/thally-track.yml')).toBe(false)
      expect(shouldInclude('thally-main/.github/CODEOWNERS')).toBe(false)
    })

    it('still includes the platform source, docs.json, and generic CI', () => {
      // The Track/agent CODE ships (it's the platform capability, off by default);
      // only the Thally project's own config/workflows are stripped.
      expect(shouldInclude('thally-main/src/app/api/track/webhook/route.ts')).toBe(true)
      expect(shouldInclude('thally-main/src/lib/track/github-app.ts')).toBe(true)
      expect(shouldInclude('thally-main/src/components/admin/github-connect-panel.tsx')).toBe(true)
      expect(shouldInclude('thally-main/docs.json')).toBe(true)
      expect(shouldInclude('thally-main/.github/workflows/ci.yml')).toBe(true)
    })
  })

  describe('resetTrackingConfig', () => {
    let dir: string
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it("drops the template's tracking block but preserves the rest of docs.json", () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(
        join(dir, 'docs.json'),
        JSON.stringify({
          tabs: [{ tab: 'Docs' }],
          ai: { chat: true },
          tracking: { repos: [{ owner: 'thallylabs', repo: 'thally', branch: 'main' }] },
        }),
      )

      resetTrackingConfig(dir)

      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking).toBeUndefined() // a fresh site tracks NOTHING
      expect(result.tabs).toEqual([{ tab: 'Docs' }]) // everything else intact
      expect(result.ai).toEqual({ chat: true })
    })

    it('is a no-op when there is no tracking block (already clean)', () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(join(dir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs' }] }))
      expect(() => resetTrackingConfig(dir)).not.toThrow()
      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking).toBeUndefined()
      expect(result.tabs).toEqual([{ tab: 'Docs' }])
    })
  })

  describe('writeTrackingConfig (opt-in during setup)', () => {
    let dir: string
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('registers the chosen repos (branch main) when the user opts in', () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(join(dir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs' }] }))

      writeTrackingConfig(dir, [{ owner: 'acme', repo: 'api' }, { owner: 'acme', repo: 'web' }])

      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking.repos).toEqual([
        { owner: 'acme', repo: 'api', branch: 'main' },
        { owner: 'acme', repo: 'web', branch: 'main' },
      ])
      expect(result.tabs).toEqual([{ tab: 'Docs' }]) // rest untouched
    })

    it('writes nothing when the user opts out (empty list)', () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(join(dir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs' }] }))
      writeTrackingConfig(dir, [])
      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking).toBeUndefined()
    })
  })
})
