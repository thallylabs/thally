/** Deterministic GitHub and GitLab repository cards that never fetch remote metadata. */

import { Github } from 'lucide-react'
import type { ReactNode } from 'react'
import { GitlabIcon } from '@/components/layout/gitlab-icon'

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

/** GitLab project paths: `group/project` up to 20 nested subgroups deep. */
const GITLAB_SEGMENT = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,254}$/

/** Convert a bounded `group/[subgroup/]project` identifier into a safe gitlab.com URL. */
export function gitlabRepositoryHref(repo: string): string | null {
  const segments = repo.trim().split('/')
  if (segments.length < 2 || segments.length > 21) return null
  if (!segments.every((segment) => GITLAB_SEGMENT.test(segment) && segment !== '.' && segment !== '..')) return null
  return `https://gitlab.com/${segments.join('/')}`
}

function RepositoryCard({
  href,
  repo,
  title,
  description,
  children,
  icon: Icon,
}: GitHubCardProps & { href: string | null; icon: typeof Github | typeof GitlabIcon }) {
  if (!href) return null
  const label = title?.trim() || repo.trim()

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="not-prose my-4 flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-foreground no-underline transition-colors hover:border-foreground/25"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <strong className="block truncate text-sm font-semibold">{label}</strong>
        {description || children ? (
          <span className="mt-1 block text-sm leading-6 text-foreground/65">{description || children}</span>
        ) : null}
      </span>
    </a>
  )
}

/** Render GitHub repository identity from authored data, without API tokens or request-time network I/O. */
export function GitHubCard(props: GitHubCardProps) {
  return <RepositoryCard {...props} href={githubRepositoryHref(props.repo)} icon={Github} />
}

/** Render a gitlab.com project card from authored data. */
export function GitLabCard(props: GitHubCardProps) {
  return <RepositoryCard {...props} href={gitlabRepositoryHref(props.repo)} icon={GitlabIcon} />
}

/**
 * Mintlify spells this as the compound tag `<GitHub.Repo>`; keep that static
 * property on the export so a member-expression JSX tag resolves to it (a
 * plain wrapper component would discard it, since it isn't a prop).
 */
export const GitHub = Object.assign(GitHubCard, { Repo: GitHubCard })

/** GitLab counterpart, with the same compound `<GitLab.Repo>` spelling. */
export const GitLab = Object.assign(GitLabCard, { Repo: GitLabCard })
