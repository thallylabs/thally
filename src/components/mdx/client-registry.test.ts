/**
 * `@thallylabs/migrate` cannot import this app's `src/` at runtime (it ships
 * standalone), so `packages/migrate/src/components.ts` keeps a hardcoded
 * snapshot of which `mdx-components.tsx` registry names are backed by a
 * 'use client' module here (`CLIENT_BUILTIN_COMPONENT_TAGS`). This test
 * recomputes the same set straight from the registry and this directory's
 * files, so a renderer change that adds/removes/re-homes a client component
 * fails CI here instead of silently going stale in the migrator.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CLIENT_BUILTIN_COMPONENT_TAGS } from '../../../packages/migrate/src/components.js'

const mdxDir = dirname(fileURLToPath(import.meta.url))
const registrySource = readFileSync(join(mdxDir, 'mdx-components.tsx'), 'utf8')

/** name imported into mdx-components.tsx -> module it came from (e.g. '@/components/mdx/panel') */
function importedBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>()
  const importRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(importRe)) {
    const [, named, def, mod] = match
    if (def) bindings.set(def, mod)
    if (named) {
      for (const raw of named.split(',')) {
        const part = raw.trim().replace(/^type\s+/, '')
        if (!part) continue
        const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/)
        bindings.set(asMatch ? asMatch[2] : part, mod)
      }
    }
  }
  return bindings
}

/** Registry object key -> local identifier its JSX/value actually renders (e.g. Accordion -> Accordion, 'Color.Item' -> Color). */
function registryEntries(source: string): Map<string, string> {
  const start = source.indexOf('const components: MDXComponents = {')
  const body = source.slice(start).split('\n')
  const entries = new Map<string, string>()
  for (const line of body) {
    const kv = line.match(/^\s*(['"]?[\w.]+['"]?):\s*(.+?),?\s*$/)
    if (!kv) continue
    const key = kv[1].replace(/['"]/g, '')
    const rhs = kv[2]
    const jsxMatch = rhs.match(/<([\w.]+)[\s/>]/)
    const identMatch = !jsxMatch ? rhs.match(/^([\w.]+)$/) : null
    const local = (jsxMatch?.[1] ?? identMatch?.[1])?.split('.')[0]
    if (local) entries.set(key, local)
  }
  return entries
}

function isClientDirectiveFile(fileName: string): boolean {
  const content = readFileSync(join(mdxDir, fileName), 'utf8')
  return /^['"]use client['"]/m.test(content)
}

it('every mdx-components.tsx registry name backed by a use-client file in this directory is captured', () => {
  const bindings = importedBindings(registrySource)
  const entries = registryEntries(registrySource)
  const clientFiles = new Set(readdirSync(mdxDir).filter((f) => f.endsWith('.tsx') && isClientDirectiveFile(f)))

  const expectedClientTags = new Set<string>()
  for (const [key, local] of entries) {
    const mod = bindings.get(local)
    if (!mod?.startsWith('@/components/mdx/')) continue
    const fileName = `${mod.slice('@/components/mdx/'.length)}.tsx`
    if (clientFiles.has(fileName) && /^[A-Z]/.test(key)) expectedClientTags.add(key)
  }

  expect([...CLIENT_BUILTIN_COMPONENT_TAGS].sort()).toEqual([...expectedClientTags].sort())
})

describe('sanity', () => {
  it('found at least one use-client mdx file to compare against', () => {
    const clientFiles = readdirSync(mdxDir).filter((f) => f.endsWith('.tsx') && isClientDirectiveFile(f))
    expect(clientFiles.length).toBeGreaterThan(0)
  })
})
