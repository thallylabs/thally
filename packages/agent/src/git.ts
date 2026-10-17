import { execFileSync } from 'node:child_process'

function git(cwd: string, args: Array<string>): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitTry(cwd: string, args: Array<string>): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(cwd, args) }
  } catch {
    return { ok: false, out: '' }
  }
}

/**
 * Precondition for the git sandbox: the target must be a git repo with a clean
 * working tree. Otherwise the agent would mix the user's uncommitted work into
 * its branch and the reset would destroy it. Refuse loudly; never auto-init.
 */
export function assertCleanGitRepo(cwd: string): void {
  if (!gitTry(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    throw new Error('`thally agent` needs a git repository to sandbox its edits — none found here.')
  }
  if (git(cwd, ['status', '--porcelain'])) {
    throw new Error('Working tree is not clean. Commit or stash your changes before running `thally agent`.')
  }
}

export function currentBranch(cwd: string): string {
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function createBranch(cwd: string, name: string): void {
  git(cwd, ['checkout', '-b', name])
}

export function checkoutBranch(cwd: string, name: string): void {
  git(cwd, ['checkout', name])
}

export function deleteBranch(cwd: string, name: string): void {
  gitTry(cwd, ['branch', '-D', name])
}

/** Staged diff including new files (write tools create untracked MDX). */
export function stagedDiff(cwd: string): string {
  git(cwd, ['add', '-A'])
  return execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf8' })
}

/** Discard everything back to HEAD, including new untracked files. */
export function hardReset(cwd: string): void {
  gitTry(cwd, ['reset', '--hard', 'HEAD'])
  gitTry(cwd, ['clean', '-fd'])
}

export function commitAll(cwd: string, message: string): void {
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '-m', message])
}

export function push(cwd: string, branch: string): void {
  git(cwd, ['push', '-u', 'origin', branch])
}

/** Strip any user, password, or token from a remote URL before it is parsed or printed. */
export function redactRemoteUrl(remote: string): string {
  try {
    const url = new URL(remote)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      url.username = ''
      url.password = ''
      return url.toString().replace(/\/$/, '')
    }
  } catch {
    // scp-style remotes (git@host:path) carry no secret.
  }
  return remote
}

/** The `origin` remote URL with credentials removed, or null when there is none. */
export function originRemoteUrl(cwd: string): string | null {
  const remote = gitTry(cwd, ['config', '--get', 'remote.origin.url'])
  return remote.ok && remote.out ? redactRemoteUrl(remote.out) : null
}

/**
 * Push a branch to an HTTPS remote with a token. The token reaches git through
 * a one-shot credential helper that reads it from the environment, so it never
 * appears in argv, the process list, or `.git/config`. Any helper configured
 * on the machine is bypassed for this command.
 */
export function pushWithToken(
  cwd: string,
  branch: string,
  remoteUrl: string,
  auth: { username: string; token: string },
): void {
  if (!/^[A-Za-z0-9._-]+$/.test(auth.username)) throw new Error('Invalid git username.')
  execFileSync(
    'git',
    [
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=!f() { echo username=${auth.username}; echo "password=$THALLY_PUSH_TOKEN"; }; f`,
      'push',
      redactRemoteUrl(remoteUrl),
      `HEAD:refs/heads/${branch}`,
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, THALLY_PUSH_TOKEN: auth.token, GIT_TERMINAL_PROMPT: '0' },
    },
  )
}

/** Whether the working tree has any changes. */
export function hasChanges(cwd: string): boolean {
  return git(cwd, ['status', '--porcelain']).length > 0
}
