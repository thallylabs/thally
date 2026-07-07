import { Suspense } from 'react'
import { DocsAccessForm } from '@/components/admin/docs-access-form'

export default function DocsAccessPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <DocsAccessForm />
    </Suspense>
  )
}
