import { notFound } from 'next/navigation'
import { DocLayout } from '@/components/docs/doc-layout'
import { getBreadcrumbs, getSeoConfig } from '@/data/docs'
import { getDocFromParams } from '@/data/get-doc'
import { pageFullTitle } from '@/lib/page-meta'
import { resolveBuildSiteConfig } from '@/lib/site-config'
import { getSiteUrl } from '@/lib/site-url'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'

export async function generateMetadata() {
  const doc = await getDocFromParams(['changelog'])
  if (!doc) return {}
  const siteUrl = getSiteUrl()
  const ogImageUrl = buildOgImageUrl({
    title: doc.title,
    description: doc.description,
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
    description: doc.description,
    alternates: { canonical: `${siteUrl}${doc.href}` },
    openGraph: {
      title: doc.title,
      description: doc.description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: doc.title,
      description: doc.description,
      images: [ogImageUrl],
    },
  }
}

export default async function ChangelogPage() {
  const doc = await getDocFromParams(['changelog'])
  if (!doc) notFound()

  const Content = doc.component
  return (
    <DocLayout doc={doc}>
      <Content />
    </DocLayout>
  )
}
