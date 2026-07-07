import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getDocFromParams } from '@/data/get-doc'
import { DocLayout } from '@/components/docs/doc-layout'

export default async function DocsNotFound() {
  // Allow projects to define a custom 404 page at src/content/404.mdx
  const custom = await getDocFromParams(['404'])
  if (custom) {
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
      <h1 className="mt-4 text-3xl font-semibold text-foreground">We misplaced that page</h1>
      <p className="mt-2 text-sm text-foreground/70">
        The document you asked for does not exist in this workspace yet. Try heading back to the docs home.
      </p>
      <div className="mt-6">
        <Button asChild>
          <Link href="/">Back to docs</Link>
        </Button>
      </div>
    </div>
  )
}


