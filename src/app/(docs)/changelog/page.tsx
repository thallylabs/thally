/** Changelog shares the document route's locale metadata and access policy. */

import DocsPage, { generateMetadata as generateDocsMetadata } from '@/app/(docs)/[[...slug]]/page'

export async function generateMetadata() {
  return generateDocsMetadata({ params: Promise.resolve({ slug: ['changelog'] }) })
}

export default async function ChangelogPage() {
  return DocsPage({ params: Promise.resolve({ slug: ['changelog'] }) })
}
