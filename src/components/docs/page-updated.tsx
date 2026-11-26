/** Compact, semantic date label shared by prose and generated API page headers. */

import { formatPageUpdateDate, normalizePageUpdateMetadata, type PageUpdateMetadata } from '@/lib/page-update'

/** Render provenance honestly: a first import says Published rather than Updated. */
export function PageUpdated({ pageUpdate, locale = 'en' }: { pageUpdate?: PageUpdateMetadata; locale?: string }) {
  const update = normalizePageUpdateMetadata(pageUpdate)
  if (!update) return null
  return (
    <p className="thally-page-updated mt-2 text-xs leading-5 text-muted-foreground" data-update-source={update.source}>
      {update.source === 'first-published' ? 'Published' : 'Updated'}{' '}
      <time dateTime={update.date}>{formatPageUpdateDate(update, locale)}</time>
    </p>
  )
}
