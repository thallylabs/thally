import { DocLayout } from '@/components/docs/doc-layout'
import { canReaderViewPage, getBreadcrumbs } from '@/data/docs'
import { getReaderContext } from '@/lib/reader-auth/context'
import { denyDocumentAccess } from '@/lib/reader-auth/page-gate'
import { getDocFromParams } from '@/data/get-doc'
import { getSiteUrl } from '@/lib/site-url'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'

export async function generateMetadata() {
  const doc = await getDocFromParams(['changelog'])
  if (!doc) return {}
  if (!(await canReaderViewPage(doc.id, await getReaderContext()))) return {}
  const siteUrl = getSiteUrl()
  const ogImageUrl = buildOgImageUrl({
    title: doc.title,
    description: doc.description,
    crumb: formatOgBreadcrumb(getBreadcrumbs(doc.href), doc.title, doc.group),
    url: formatOgDisplayUrl(doc.href, siteUrl),
  })

  return {
    title: doc.title,
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
  const reader = await getReaderContext()
  const doc = await getDocFromParams(['changelog'])
  if (!doc || !(await canReaderViewPage(doc.id, reader))) denyDocumentAccess(reader, '/changelog')

  const Content = doc.component
  return (
    <DocLayout doc={doc}>
      <Content />
    </DocLayout>
  )
}
