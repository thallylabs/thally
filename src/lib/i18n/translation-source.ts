/**
 * Resolve locale MDX sources and crawler eligibility without importing the
 * rendering pipeline. Search, sitemap, and APIs must stay out of the MDX
 * compiler bundle.
 */

import { getI18nConfig } from '@/data/docs'
import { getContentSource, type ContentSource } from '@/lib/content-source'
import { parseFrontmatter } from '@/lib/frontmatter'

const localDocsRoot = 'src/content'

function projectJoin(...segments: Array<string>): string {
  return segments.flatMap((segment) => segment.split('/')).filter(Boolean).join('/')
}

export interface DocSourceResult {
  filePath: string
  sourcePath?: string
  isFallback: boolean
  isStale: boolean
}

/**
 * Check whether a locale has an authored MDX source without compiling it.
 * Crawler surfaces call this across many pages and locales, so keeping the
 * operation at the content-source `exists` layer avoids turning sitemap reads
 * into a burst of MDX compilation work.
 */
export async function hasDocTranslation(
  slugSegments: Array<string> | undefined,
  locale: string,
): Promise<boolean> {
  const source = getContentSource()
  const normalized = Array.isArray(slugSegments)
    ? slugSegments.filter(Boolean)
    : []
  const candidate = await findDocSource(source, normalized.join('/'), locale)
  return Boolean(candidate && !candidate.isFallback)
}

/** Read crawler eligibility from the translated file, not just its existence. */
export async function getIndexableDocTranslation(
  slugSegments: Array<string> | undefined,
  locale: string,
): Promise<{
  lastUpdated?: string
  title?: string
  description?: string
  keywords?: Array<string>
} | null> {
  const source = getContentSource()
  const slugPath = (slugSegments ?? []).filter(Boolean).join('/')
  const candidate = await findDocSource(source, slugPath, locale)
  if (!candidate || candidate.isFallback) return null
  const file = await source.read(candidate.filePath)
  if (!file) return null
  const data = parseFrontmatter(file.content).data
  const sourceFile = candidate.sourcePath ? await source.read(candidate.sourcePath) : null
  const sourceData = sourceFile ? parseFrontmatter(sourceFile.content).data : {}
  if (data.noindex === true || data.hidden === true || sourceData.noindex === true || sourceData.hidden === true) return null
  return {
    ...(typeof data.lastUpdated === 'string' ? { lastUpdated: data.lastUpdated } : {}),
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    ...(typeof data.description === 'string' ? { description: data.description } : {}),
    ...(Array.isArray(data.keywords) && data.keywords.every((word) => typeof word === 'string')
      ? { keywords: data.keywords as Array<string> }
      : {}),
  }
}

const generatedTranslationMarker = /thally:ai-translation\s+locale=[A-Za-z0-9-]+\s+source-sha=([a-f0-9]{64})/

async function isTranslationStale(
  source: ContentSource,
  primaryPath: string,
  localePath: string,
): Promise<boolean> {
  const [primary, translated] = await Promise.all([
    source.read(primaryPath),
    source.read(localePath),
  ])
  if (!primary || !translated) return false
  const marker = generatedTranslationMarker.exec(translated.content)
  if (marker) {
    // Cloud's provenance hash measures the source bytes. Git checkout times do
    // not measure content revisions, so use the same digest on reader routes.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(primary.content))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return marker[1] !== hash
  }
  // Human-authored files have no source revision marker. Deployment mtimes
  // can be reset together, so their freshness is unknown rather than stale.
  return false
}

/** Resolve a route to a source file without loading the MDX compiler. */
export async function findDocSource(
  source: ContentSource,
  slugPath: string,
  locale?: string,
): Promise<DocSourceResult | null> {
  // Route segments are untrusted. Keep content reads inside src/content even
  // under the development filesystem source, which accepts project paths.
  if (
    /[\\\0]/.test(slugPath) ||
    slugPath.split('/').some((segment) => segment === '.' || segment === '..') ||
    (locale !== undefined && !/^[A-Za-z0-9-]+$/.test(locale))
  ) return null
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

  // A translated file alone must not keep a deleted or renamed source page
  // indexable. The source path is the current document identity.
  let primaryPath: string | null = null
  for (const candidate of primaryCandidates) {
    if (await source.exists(candidate)) {
      primaryPath = candidate
      break
    }
  }
  if (!primaryPath) return null

  for (const localeFilePath of localeCandidates) {
    if (await source.exists(localeFilePath)) {
      const isStale = await isTranslationStale(source, primaryPath, localeFilePath)
      return { filePath: localeFilePath, sourcePath: primaryPath, isFallback: false, isStale }
    }
  }

  // Fall back to primary
  return { filePath: primaryPath, isFallback: true, isStale: false }
}
