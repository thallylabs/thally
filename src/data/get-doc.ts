'use server'

import { createElement, type ComponentType, type ReactNode } from 'react'
import { compileMDX } from 'next-mdx-remote/rsc'
import type { DocEntry, DocPageMode, OpenApiReference } from '@/data/docs'
import { deriveTitleFromSlug, getI18nConfig } from '@/data/docs'
import { remarkPlugins } from '@/mdx/remark'
import { rehypePlugins } from '@/mdx/rehype'
import { useMDXComponents as getMDXComponents } from '@/components/mdx/mdx-components'
import { resolveSnippetComponent } from '@/mdx/snippet-registry'
import { runtimeDocs } from '@/generated/runtime-docs'
import { readRuntimeSource, runtimeSourceExists } from '@/lib/runtime-sources'
import { ensureDynamicContentRendering, getContentSource, type ContentSource } from '@/lib/content-source'

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

const localDocsRoot = 'src/content'

function projectJoin(...segments: Array<string>): string {
  return segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .join('/')
}

export interface DocSourceResult {
  filePath: string
  isFallback: boolean
  isStale: boolean
}

const dynamicDocCache = new Map<string, Promise<(DocEntry & { isFallback: boolean; isStale: boolean }) | null>>()

export async function getDocFromParams(slugSegments?: Array<string>, locale?: string) {
  // Remote content must never be baked into a static or ISR-cached render —
  // a no-op under the default filesystem source. Called before the cache
  // lookup so every request opts out, not just the first.
  await ensureDynamicContentRendering()

  const normalized = Array.isArray(slugSegments) ? slugSegments.filter(Boolean) : []
  const slugKey = normalized.join('/')

  const cacheKey = locale ? `${locale}:${slugKey}` : slugKey
  let pending = dynamicDocCache.get(cacheKey)
  if (!pending) {
    pending = loadDocFromSource(normalized, locale)
    dynamicDocCache.set(cacheKey, pending)
  }

  return pending
}

async function loadDocFromSource(
  slugSegments: Array<string>,
  locale?: string,
): Promise<(DocEntry & { isFallback: boolean; isStale: boolean }) | null> {
  const source = getContentSource()
  const slugPath = slugSegments.join('/')
  const candidate = await findDocSource(source, slugPath, locale)
  if (!candidate) {
    return null
  }
  return compileDocEntry(source, candidate.filePath, slugSegments, candidate.isFallback, candidate.isStale)
}

async function findDocSource(
  source: ContentSource,
  slugPath: string,
  locale?: string,
): Promise<DocSourceResult | null> {
  const normalized = slugPath || 'introduction'
  const i18n = getI18nConfig()
  const defaultLocale = i18n?.defaultLocale ?? 'en'
  const isDefault = !locale || locale === defaultLocale

  if (isDefault) {
    const candidates = normalized.endsWith('.mdx')
      ? [normalized]
      : [`${normalized}.mdx`, `${normalized}/index.mdx`]

    for (const candidate of candidates) {
      const filePath = projectJoin(localDocsRoot, candidate)
      if (await source.exists(filePath)) {
        return { filePath, isFallback: false, isStale: false }
      }
    }
    return null
  }

  // Secondary locale: try translated file first, then fall back to primary
  const localeCandidates = normalized.endsWith('.mdx')
    ? [projectJoin(localDocsRoot, locale, normalized)]
    : [
        projectJoin(localDocsRoot, locale, `${normalized}.mdx`),
        projectJoin(localDocsRoot, locale, `${normalized}/index.mdx`),
      ]

  const primaryCandidates = normalized.endsWith('.mdx')
    ? [projectJoin(localDocsRoot, normalized)]
    : [
        projectJoin(localDocsRoot, `${normalized}.mdx`),
        projectJoin(localDocsRoot, `${normalized}/index.mdx`),
      ]

  for (const localeFilePath of localeCandidates) {
    if (await source.exists(localeFilePath)) {
      // Translation file exists — check staleness against primary
      let isStale = false
      for (const primaryPath of primaryCandidates) {
        if (await source.exists(primaryPath)) {
          if ((await source.modifiedAt(primaryPath)) > (await source.modifiedAt(localeFilePath))) {
            isStale = true
          }
          break
        }
      }
      return { filePath: localeFilePath, isFallback: false, isStale }
    }
  }

  // Fall back to primary
  for (const primaryPath of primaryCandidates) {
    if (await source.exists(primaryPath)) {
      return { filePath: primaryPath, isFallback: true, isStale: false }
    }
  }

  return null
}

/**
 * Whether this render must compile MDX now instead of using the module the
 * build precompiled. Development always compiles for fresh authoring
 * feedback. The assets source compiles only files that actually changed
 * since the build: an unchanged file is byte-identical to its embedded copy,
 * so reusing the precompiled module skips the request-time compile (and, on
 * workerd, the dynamic-eval requirement) for everything except edited pages.
 */
function needsRuntimeCompile(source: ContentSource, filePath: string, content: string): boolean {
  if (process.env.NODE_ENV === 'development') return true
  if (source.kind !== 'assets') return false
  return !(runtimeSourceExists(filePath) && readRuntimeSource(filePath) === content)
}

async function compileDocEntry(
  source: ContentSource,
  filePath: string,
  slugSegments: Array<string>,
  isFallback: boolean,
  isStale: boolean,
): Promise<(DocEntry & { isFallback: boolean; isStale: boolean }) | null> {
  const sourceFile = await source.read(filePath)
  if (!sourceFile) return null
  const { cleanedSource, snippetInjectors } = extractSnippetComponents(sourceFile.content)
  const resolvedSnippetComponents: Record<string, ComponentType<Record<string, unknown>>> = {}
  for (const [name, resolver] of Object.entries(snippetInjectors)) {
    resolvedSnippetComponents[name] = (await resolver()) as ComponentType<Record<string, unknown>>
  }
  const components = getMDXComponents(resolvedSnippetComponents)
  let content: ReactNode
  let frontmatter: DocFrontmatter

  if (needsRuntimeCompile(source, filePath, sourceFile.content)) {
    const compiled = await compileMDX<DocFrontmatter>({
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
    content = compiled.content
    frontmatter = compiled.frontmatter
  } else {
    const compiled = runtimeDocs[filePath]
    if (!compiled) return null
    content = createElement(compiled.component, { components })
    frontmatter = compiled.frontmatter as DocFrontmatter
  }

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

const SNIPPETS_ROOT = 'snippets'

async function compileSnippetFromPath(snippetImportPath: string): Promise<ComponentType<Record<string, unknown>>> {
  const source = getContentSource()
  const relative = snippetImportPath.replace(/^\/snippets\//, '').replace(/\.mdx$/, '')
  const candidates = [
    projectJoin(SNIPPETS_ROOT, `${relative}.mdx`),
    projectJoin(SNIPPETS_ROOT, relative, 'index.mdx'),
  ]

  let snippetFile: { content: string } | null = null
  let sourcePath: string | null = null
  for (const filePath of candidates) {
    const candidateFile = await source.read(filePath)
    if (candidateFile) {
      snippetFile = candidateFile
      sourcePath = filePath
      break
    }
  }

  if (!snippetFile || !sourcePath) {
    const MissingSnippet: ComponentType<Record<string, unknown>> = () => null
    return MissingSnippet
  }

  if (!needsRuntimeCompile(source, sourcePath, snippetFile.content)) {
    const compiled = runtimeDocs[sourcePath]
    if (!compiled) {
      const MissingSnippet: ComponentType<Record<string, unknown>> = () => null
      return MissingSnippet
    }
    const components = getMDXComponents({})
    const PrecompiledSnippet: ComponentType<Record<string, unknown>> = function PrecompiledSnippet() {
      return createElement(compiled.component, { components })
    }
    return PrecompiledSnippet
  }

  const { content } = await compileMDX({
    source: snippetFile.content,
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
