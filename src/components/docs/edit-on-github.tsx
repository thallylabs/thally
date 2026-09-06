import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EditOnGithubProps {
  pageId: string
  repoUrl: string
  label?: string
  className?: string
}

export function EditOnGithub({
  pageId,
  repoUrl,
  label = 'Edit this page on GitHub',
  className,
}: EditOnGithubProps) {
  if (!repoUrl || repoUrl.includes('your-org')) return null

  const filePath = `src/content/${pageId}.mdx`
  const editUrl = `${repoUrl.replace(/\/$/, '')}/edit/main/${filePath}`

  return (
    <a
      href={editUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-foreground/50 transition hover:text-foreground/80',
        className,
      )}
    >
      <Pencil className="h-3.5 w-3.5" />
      {label}
    </a>
  )
}
