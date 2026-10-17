/**
 * Shared, side-effect-free payload builders for actions attached to rendered
 * code samples. Keeping these values independent from React makes their URL
 * and prompt contracts easy to protect with regression coverage.
 */

import {
  issueQueryKeys,
  repositoryIssuesNewUrl,
  type GitHostConfig,
} from '@thallylabs/core/repository'
import { resolveRepository } from '@/lib/repository-links'

/** Build the assistant question shown after a reader selects a code sample. */
export function createCodeAssistantPrompt(code: string): string {
  return `Explain this code sample and check it for mistakes:\n\n\`\`\`\n${code}\n\`\`\``
}

/**
 * Build a safe issue URL for a code-sample report on GitHub or GitLab.
 *
 * A site owner may leave repository configuration blank or accidentally enter
 * a non-web URL. Returning null lets the UI disable reporting rather than
 * opening an arbitrary scheme from a documentation page.
 */
export function buildCodeReportUrl({
  repositoryUrl,
  pageUrl,
  code,
  gitHosts,
}: {
  repositoryUrl: string
  pageUrl: string
  code: string
  /** Declared self-hosted hosts, so a self-hosted GitLab gets GitLab issue URLs. */
  gitHosts?: ReadonlyArray<GitHostConfig>
}): string | null {
  const repository = resolveRepository(repositoryUrl, gitHosts)
  if (!repository) return null
  try {
    const url = new URL(repositoryIssuesNewUrl(repository))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const keys = issueQueryKeys(repository.provider)
    url.searchParams.set(keys.title, 'Docs: incorrect code sample')
    url.searchParams.set(
      keys.body,
      `Page: ${pageUrl}\n\nCode sample:\n\n\`\`\`\n${code}\n\`\`\``,
    )
    return url.toString()
  } catch {
    return null
  }
}
