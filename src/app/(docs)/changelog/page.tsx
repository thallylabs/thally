import { notFound } from 'next/navigation'
import { DocLayout } from '@/components/docs/doc-layout'
import { getDocFromParams } from '@/data/get-doc'

export async function generateMetadata() {
  const doc = await getDocFromParams(['changelog'])
  if (!doc) return {}
  return { title: doc.title, description: doc.description }
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
