/** Deterministic GitHub repository cards that never fetch remote metadata. */

import { Github } from 'lucide-react'
import type { ReactNode } from 'react'

export interface GitHubCardProps {
  repo: string
  title?: string
  description?: string
  children?: ReactNode
}

const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/

/** Convert a bounded `owner/repository` identifier into a safe GitHub URL. */
export function githubRepositoryHref(repo: string): string | null {
  const normalized = repo.trim()
  return REPOSITORY_PATTERN.test(normalized) ? `https://github.com/${normalized}` : null
}

/** Render repository identity from authored data, without API tokens or request-time network I/O. */
export function GitHubCard({ repo, title, description, children }: GitHubCardProps) {
  const href = githubRepositoryHref(repo)
  if (!href) return null
  const label = title?.trim() || repo.trim()

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="not-prose my-4 flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-foreground no-underline transition-colors hover:border-foreground/25"
    >
      <Github className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <strong className="block truncate text-sm font-semibold">{label}</strong>
        {description || children ? (
          <span className="mt-1 block text-sm leading-6 text-foreground/65">{description || children}</span>
        ) : null}
      </span>
    </a>
  )
}

/** Mintlify-compatible component spelling. */
export const GitHub = GitHubCard
