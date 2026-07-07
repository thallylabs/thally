'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import type { ComponentType } from 'react'
import { compileMDX } from 'next-mdx-remote/rsc'
import type { DocEntry, DocPageMode, OpenApiReference } from '@/data/docs'
import { deriveTitleFromSlug, getI18nConfig } from '@/data/docs'
import { remarkPlugins } from '@/mdx/remark'
import { rehypePlugins } from '@/mdx/rehype'
import { useMDXComponents as getMDXComponents } from '@/components/mdx/mdx-components'
import { resolveSnippetComponent } from '@/mdx/snippet-registry'

interface DocFrontmatter {
  title?: string
  description?: string
  group?: string
  badge?: string
  keywords?: Array<string>
  timeEstimate?: string
  lastUpdated?: string
  openapi?: string
  noindex?: boolean
  hidden?: boolean
  mode?: DocPageMode
}

const localDocsRoot = path.join(process.cwd(), 'src/content')

export interface DocSourceResult {
  filePath: string
  isFallback: boolean
  isStale: boolean
}

const dynamicDocCache = new Map<string, Promise<(DocEntry & { isFallback: boolean; isStale: boolean }) | null>>()

export async function getDocFromParams(slugSegments?: Array<string>, locale?: string) {
  const normalized = Array.isArray(slugSegments) ? slugSegments.filter(Boolean) : []
  const slugKey = normalized.join('/')

  const cacheKey = locale ? `${locale}:${slugKey}` : slugKey
  let pending = dynamicDocCache.get(cacheKey)
  if (!pending) {
    pending = loadDocFromFilesystem(normalized, locale)
    dynamicDocCache.set(cacheKey, pending)
  }

  return pending
}

async function loadDocFromFilesystem(
  slugSegments: Array<string>,
  locale?: string,
): Promise<(DocEntry & { isFallback: boolean; isStale: boolean }) | null> {
  const slugPath = slugSegments.join('/')
  const candidate = await findDocSource(slugPath, locale)
  if (!candidate) {
    return null
  }
  return compileDocEntry(candidate.filePath, slugSegments, candidate.isFallback, candidate.isStale)
}

async function findDocSource(slugPath: string, locale?: string): Promise<DocSourceResult | null> {
  const normalized = slugPath || 'introduction'
  const i18n = getI18nConfig()
  const defaultLocale = i18n?.defaultLocale ?? 'en'
  const isDefault = !locale || locale === defaultLocale

  if (isDefault) {
    const candidates = normalized.endsWith('.mdx')
      ? [normalized]
      : [`${normalized}.mdx`, `${normalized}/index.mdx`]

    for (const candidate of candidates) {
      const filePath = path.join(localDocsRoot, candidate)
      try {
        await fs.access(filePath)
        return { filePath, isFallback: false, isStale: false }
      } catch {
        // continue
      }
    }
    return null
  }

  // Secondary locale: try translated file first, then fall back to primary
  const localeCandidates = normalized.endsWith('.mdx')
    ? [path.join(localDocsRoot, locale, normalized)]
    : [
        path.join(localDocsRoot, locale, `${normalized}.mdx`),
        path.join(localDocsRoot, locale, `${normalized}/index.mdx`),
      ]

  const primaryCandidates = normalized.endsWith('.mdx')
    ? [path.join(localDocsRoot, normalized)]
    : [
        path.join(localDocsRoot, `${normalized}.mdx`),
        path.join(localDocsRoot, `${normalized}/index.mdx`),
      ]

  for (const localeFilePath of localeCandidates) {
    try {
      await fs.access(localeFilePath)
      // Translation file exists — check staleness against primary
      let isStale = false
      for (const primaryPath of primaryCandidates) {
        try {
          const [localeStat, primaryStat] = await Promise.all([
            fs.stat(localeFilePath),
            fs.stat(primaryPath),
          ])
          if (primaryStat.mtime > localeStat.mtime) {
            isStale = true
          }
          break
        } catch {
          // primary not found, can't check staleness
        }
      }
      return { filePath: localeFilePath, isFallback: false, isStale }
    } catch {
      // continue
    }
  }

  // Fall back to primary
  for (const primaryPath of primaryCandidates) {
    try {
      await fs.access(primaryPath)
      return { filePath: primaryPath, isFallback: true, isStale: false }
    } catch {
      // continue
    }
  }

  return null
}

async function compileDocEntry(
  filePath: string,
  slugSegments: Array<string>,
  isFallback: boolean,
  isStale: boolean,
): Promise<(DocEntry & { isFallback: boolean; isStale: boolean }) | null> {
  const source = await fs.readFile(filePath, 'utf8')
  const { cleanedSource, snippetInjectors } = extractSnippetComponents(source)
  const resolvedSnippetComponents: Record<string, ComponentType<Record<string, unknown>>> = {}
  for (const [name, resolver] of Object.entries(snippetInjectors)) {
    resolvedSnippetComponents[name] = (await resolver()) as ComponentType<Record<string, unknown>>
  }
  const components = getMDXComponents(resolvedSnippetComponents)
  const { content, frontmatter } = await compileMDX<DocFrontmatter>({
    source: cleanedSource,
    components,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins,
        rehypePlugins,
      },
    },
  })

  const slugPath = slugSegments.join('/')
  const href = slugPath ? `/${slugPath}` : '/'
  const GeneratedDoc: ComponentType<Record<string, unknown>> = function GeneratedDoc() {
    return content
  }
  GeneratedDoc.displayName = `DocContent(${href})`

  const openapi = parseOpenApiReference(frontmatter?.openapi)

  return {
    id: slugPath || frontmatter?.title || 'doc',
    title: frontmatter?.title ?? deriveTitleFromSlug(slugPath),
    description: frontmatter?.description ?? '',
    slug: slugSegments,
    href,
    group: frontmatter?.group ?? 'Docs',
    badge: frontmatter?.badge,
    keywords: frontmatter?.keywords ?? [],
    component: GeneratedDoc,
    timeEstimate: frontmatter?.timeEstimate ?? '5 min',
    lastUpdated: frontmatter?.lastUpdated ?? new Date().toISOString().slice(0, 10),
    openapi: openapi ?? undefined,
    noindex: frontmatter?.noindex,
    hidden: frontmatter?.hidden,
    mode: frontmatter?.mode,
    isFallback,
    isStale,
  }
}

const snippetImportPattern = /^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm

function extractSnippetComponents(source: string) {
  const snippetInjectors: Record<string, () => Promise<ComponentType<Record<string, unknown>>>> = {}
  const cleanedSource = source.replace(snippetImportPattern, (statement, imports, fromPath) => {
    const normalizedPath = typeof fromPath === 'string' ? fromPath.trim() : ''
    if (!normalizedPath.startsWith('/snippets/')) {
      return statement
    }

    const names = imports
      .split(',')
      .map((name: string) => name.trim())
      .filter(Boolean)

    names.forEach((name: string) => {
      const loader = resolveSnippetComponent(normalizedPath, name)
      if (loader) {
        snippetInjectors[name] = loader
      } else {
        snippetInjectors[name] = () => compileSnippetFromPath(normalizedPath)
      }
    })

    return ''
  })

  return { cleanedSource, snippetInjectors }
}

const SNIPPETS_ROOT = path.join(process.cwd(), 'snippets')

async function compileSnippetFromPath(snippetImportPath: string): Promise<ComponentType<Record<string, unknown>>> {
  const relative = snippetImportPath.replace(/^\/snippets\//, '').replace(/\.mdx$/, '')
  const candidates = [
    path.join(SNIPPETS_ROOT, `${relative}.mdx`),
    path.join(SNIPPETS_ROOT, relative, 'index.mdx'),
  ]

  let source: string | null = null
  for (const filePath of candidates) {
    try {
      source = await fs.readFile(filePath, 'utf8')
      break
    } catch {
      // try next candidate
    }
  }

  if (!source) {
    const MissingSnippet: ComponentType<Record<string, unknown>> = () => null
    return MissingSnippet
  }

  const { content } = await compileMDX({
    source,
    components: getMDXComponents({}),
    options: {
      parseFrontmatter: false,
      mdxOptions: { remarkPlugins, rehypePlugins },
    },
  })

  const SnippetComponent: ComponentType<Record<string, unknown>> = function SnippetComponent() {
    return content
  }
  return SnippetComponent
}

function parseOpenApiReference(raw?: string): OpenApiReference | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) {
    return null
  }

  const method = parts[0]?.toUpperCase()
  const path = parts.slice(1).join(' ')
  if (!method || !path.startsWith('/')) {
    return null
  }

  return {
    specId: 'default',
    method,
    path,
  }
}
