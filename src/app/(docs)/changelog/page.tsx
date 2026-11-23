/** Changelog content and its complete, canonical social metadata. */
import type { Metadata } from 'next'
import { DocLayout } from '@/components/docs/doc-layout'
import { getBreadcrumbs, getSeoConfig, canReaderViewPage } from '@/data/docs'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'
import { getContentI18nConfig } from '@/lib/i18n/content'
import { buildLocaleAlternates } from '@/lib/i18n/metadata'
import { getReaderContext } from '@/lib/reader-auth/context'
import { canReaderViewResolvedDoc, denyDocumentAccess } from '@/lib/reader-auth/page-gate'
import { getDocFromParams } from '@/data/get-doc'
import { plainInlineText } from '@/lib/inline-code'
import { pageFullTitle } from '@/lib/page-meta'
import { resolveBuildSiteConfig } from '@/lib/site-config'
import { getSiteUrl } from '@/lib/site-url'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'

/** Project the same published locale cluster as ordinary documentation pages. */
export async function generateMetadata(): Promise<Metadata> {
  const doc = await getDocFromParams(['changelog'])
  if (!doc) return {}
  const reader = await getReaderContext()
  if (!(await canReaderViewResolvedDoc(doc, reader))) return {}
  const i18n = await getEffectiveI18nConfig()
  const contentI18n = await getContentI18nConfig(['changelog'], i18n)
  const allowed = await Promise.all(contentI18n.locales.map(locale =>
    canReaderViewPage(doc.id, reader, locale.code === i18n.defaultLocale ? undefined : locale.code)))
  const availableI18n = { ...contentI18n, locales: contentI18n.locales.filter((_, index) => allowed[index]) }
  const siteUrl = getSiteUrl()
  const description = plainInlineText(doc.description)
  const ogImageUrl = buildOgImageUrl({
    title: doc.title,
    description,
    crumb: formatOgBreadcrumb(getBreadcrumbs(doc.href), doc.title, doc.group),
    url: formatOgDisplayUrl(doc.href, siteUrl),
  })

  const fullTitle = pageFullTitle({
    title: doc.title,
    ogTitle: doc.ogTitle,
    siteName: resolveBuildSiteConfig().name,
    separator: getSeoConfig().titleSeparator,
  })

  return {
    title: fullTitle ? { absolute: fullTitle } : doc.title,
    description,
    ...(doc.noindex || doc.hidden ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical: `${siteUrl}${doc.href}`,
      ...(!doc.noindex && !doc.hidden
        ? { languages: buildLocaleAlternates(siteUrl, doc.href, availableI18n) }
        : {}),
    },
    openGraph: {
      type: 'article',
      url: `${siteUrl}${doc.href}`,
      siteName: resolveBuildSiteConfig().name,
      title: doc.title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: doc.title,
      description,
      images: [ogImageUrl],
    },
  }
}

export default async function ChangelogPage() {
  const reader = await getReaderContext()
  const doc = await getDocFromParams(['changelog'])
  if (!doc || !(await canReaderViewResolvedDoc(doc, reader))) denyDocumentAccess(reader, '/changelog')

  const Content = doc.component
  return (
    <DocLayout doc={doc}>
      <Content />
    </DocLayout>
  )
}
