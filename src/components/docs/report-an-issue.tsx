/** Repository issue link for reader-reported documentation problems. */

import { PanelTop } from 'lucide-react'
import { repositoryNewIssueUrl, type GitHostConfig } from '@thallylabs/core/repository'
import { resolveRepository } from '@/lib/repository-links'
import { cn } from '@/lib/utils'

interface ReportAnIssueProps {
  pagePath: string
  repoUrl: string
  /** Declared self-hosted hosts, so a self-hosted GitLab gets GitLab issue URLs. */
  gitHosts?: ReadonlyArray<GitHostConfig>
  className?: string
}

/** Link readers to a pre-titled repository issue for the current docs page. */
export function ReportAnIssue({ pagePath, repoUrl, gitHosts, className }: ReportAnIssueProps) {
  const repository = resolveRepository(repoUrl, gitHosts)
  if (!repository) return null

  return (
    <a
      href={repositoryNewIssueUrl(repository, { title: `Docs feedback: ${pagePath}` })}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-foreground/50 transition hover:text-foreground/80',
        className,
      )}
    >
      <PanelTop className="h-3.5 w-3.5" />
      Report an issue
    </a>
  )
}
