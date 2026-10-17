/** "Edit this page" link into the repository's web editor (GitHub or GitLab). */

import { Pencil } from 'lucide-react'
import { providerLabel, repositoryEditFileUrl, type GitHostConfig } from '@thallylabs/core/repository'
import { resolveRepository } from '@/lib/repository-links'
import { cn } from '@/lib/utils'

interface EditOnRepositoryProps {
  pageId: string
  repoUrl: string
  /** Declared self-hosted hosts, so a self-hosted GitLab gets GitLab edit URLs. */
  gitHosts?: ReadonlyArray<GitHostConfig>
  label?: string
  className?: string
}

/** Link to edit the page's MDX source on `main` in the configured repository. */
export function EditOnRepository({
  pageId,
  repoUrl,
  gitHosts,
  label,
  className,
}: EditOnRepositoryProps) {
  const repository = resolveRepository(repoUrl, gitHosts)
  if (!repository) return null

  const editUrl = repositoryEditFileUrl(repository, 'main', `src/content/${pageId}.mdx`)

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
      {label ?? `Edit this page on ${providerLabel(repository.provider)}`}
    </a>
  )
}

/** @deprecated Use {@link EditOnRepository}; it renders GitHub and GitLab links. */
export const EditOnGithub = EditOnRepository
