import { Pencil } from 'lucide-react'
import { siteConfig } from '@/data/site'

interface EditOnGithubProps {
  pageId: string
}

export function EditOnGithub({ pageId }: EditOnGithubProps) {
  const repoUrl = siteConfig.repoUrl
  if (!repoUrl || repoUrl.includes('your-org')) return null

  const filePath = `src/content/${pageId}.mdx`
  const editUrl = `${repoUrl.replace(/\/$/, '')}/edit/main/${filePath}`

  return (
    <a
      href={editUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-foreground/50 transition hover:text-foreground/80"
    >
      <Pencil className="h-3.5 w-3.5" />
      Edit this page on GitHub
    </a>
  )
}
