import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getDocFromParams } from '@/data/get-doc'
import { DocLayout } from '@/components/docs/doc-layout'
import { canReaderViewPage } from '@/data/docs'
import { getReaderContext } from '@/lib/reader-auth/context'
import { shouldOfferReaderSignIn } from '@/lib/reader-auth/page-gate'

export default async function DocsNotFound() {
  const reader = await getReaderContext()
  // Allow projects to define a custom 404 page at src/content/404.mdx
  const custom = await getDocFromParams(['404'])
  if (custom && (await canReaderViewPage(custom.id, reader))) {
    const Content = custom.component
    return (
      <DocLayout doc={custom}>
        <Content />
      </DocLayout>
    )
  }

  return (
    <div className="rounded-3xl border border-border/60 bg-muted/30 px-10 py-16 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-foreground/50">404</p>
      <h1 className="mt-4 font-heading text-3xl font-semibold text-foreground">We misplaced that page</h1>
      <p className="mt-2 text-sm text-foreground/70">
        The document you asked for does not exist in this workspace yet. Try heading back to the docs home.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Back to docs</Link>
        </Button>
        {/* Shown on every 404 for anonymous readers, so it reveals nothing about the path. */}
        {shouldOfferReaderSignIn(reader) ? (
          <Button asChild variant="outline">
            {/* A plain anchor: the sign-in route redirects off-site, which client navigation cannot follow. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/reader/login">Sign in for more</a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}


