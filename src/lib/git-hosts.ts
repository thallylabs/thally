/**
 * Self-hosted repository hosts for this deployment.
 *
 * github.com and gitlab.com are recognised automatically. A self-hosted GitLab
 * (or GitHub Enterprise) instance is declared in docs.json
 * (`repository.hosts`) or with `THALLY_GIT_HOSTS` (`host=gitlab,...`; legacy
 * `DOX_GIT_HOSTS`). Environment entries win over docs.json for the same host.
 * The result is plain JSON so layouts can pass it to client components.
 */

import { parseGitHostsEnv, readGitHostsConfig, type GitHostConfig } from '@thallylabs/core/repository'
import { getDocsJsonConfig } from '@/lib/docs-json-config'

/** Declared repository hosts from docs.json and the environment. */
export function getGitHosts(): Array<GitHostConfig> {
  const byHost = new Map<string, GitHostConfig>()
  for (const entry of readGitHostsConfig(getDocsJsonConfig())) byHost.set(entry.host, entry)
  for (const entry of parseGitHostsEnv(process.env.THALLY_GIT_HOSTS || process.env.DOX_GIT_HOSTS)) {
    byHost.set(entry.host, entry)
  }
  return [...byHost.values()]
}
