/**
 * Shared repository-host vocabulary for every Thally surface that links to,
 * reads from, or writes to a source repository.
 *
 * These types are deliberately plain data: a {@link RepositoryRef} is
 * serializable, so server components can resolve it once and hand it to client
 * components without re-parsing configuration in the browser.
 */

/** Source-control providers Thally understands. Unknown hosts are treated as GitHub-style. */
export type GitProvider = 'github' | 'gitlab'

/**
 * A repository host declared by configuration (docs.json `repository.hosts`
 * or `THALLY_GIT_HOSTS`). Used to recognise self-hosted GitLab or GitHub
 * Enterprise instances whose hostname cannot identify the provider.
 */
export interface GitHostConfig {
  /** Hostname only, without scheme, port, or path, for example `gitlab.example.com`. */
  host: string
  provider: GitProvider
  /** REST API base when it differs from the provider default (`<origin>/api/v4` for GitLab). */
  apiBaseUrl?: string
}

/** A {@link GitHostConfig} with every default resolved. */
export interface GitProviderHost {
  host: string
  provider: GitProvider
  /** Web origin, for example `https://gitlab.example.com`. */
  origin: string
  /** REST API base without a trailing slash. */
  apiBaseUrl: string
}

/** Provider-neutral identity of one repository, plus any location the input named. */
export interface RepositoryRef {
  provider: GitProvider
  /** Lower-case hostname. */
  host: string
  /** Web origin including scheme, for example `https://github.com`. */
  origin: string
  /** REST API base for this host. */
  apiBaseUrl: string
  /** GitHub owner, or the full GitLab namespace such as `group/subgroup`. */
  owner: string
  repo: string
  /** `${owner}/${repo}`; URL-encoded, it is GitLab's project API id. */
  fullPath: string
  /** Branch named by a tree, blob, or edit URL. */
  ref?: string
  /** Subdirectory or file path named by a tree, blob, or edit URL. */
  path?: string
  /** Pull or merge request number from the input. */
  number?: number
}
