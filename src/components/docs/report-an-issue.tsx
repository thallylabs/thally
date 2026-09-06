/** Repository issue link for reader-reported documentation problems. */

import { PanelTop } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReportAnIssueProps {
  pagePath: string
  repoUrl: string
  className?: string
}

/** Link readers to a pre-titled repository issue for the current docs page. */
export function ReportAnIssue({ pagePath, repoUrl, className }: ReportAnIssueProps) {
  if (!repoUrl || repoUrl.includes('your-org')) return null

  const normalizedRepo = repoUrl.replace(/\/$/, '')
  const issueTitle = encodeURIComponent(`Docs feedback: ${pagePath}`)

  return (
    <a
      href={`${normalizedRepo}/issues/new?title=${issueTitle}`}
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
