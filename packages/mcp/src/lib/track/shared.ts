// ---------------------------------------------------------------------------
// Thally Track — provider-neutral pieces shared by every source host.
//
// Branch-namespace guards, the normalized pull/merge request DTOs, path-glob
// filtering, and the instruction/context builders. Nothing here performs I/O,
// so GitHub and GitLab clients produce identical docs tasks from the same
// normalized data.
// ---------------------------------------------------------------------------

import { parseGitHostsEnv, pullRequestLabel, type GitHostConfig } from "@thallylabs/core/repository";
import type { TrackedRepoConfig } from "@thallylabs/core/tracking";

/** The legacy docs-agent branch namespace. Retained for API compatibility. */
export const AGENT_BRANCH_PREFIX = "thally/agent-";

/**
 * Every branch namespace authored by a Track-controlled writer.
 *
 * Intake must ignore all of these namespaces. Otherwise a self-tracking docs
 * repository can treat Track's own documentation pull request as a new product
 * change and recursively create another run. Keep this list shared by Cloud,
 * generated sender workflows, and any future Track producer.
 */
export const TRACK_OWNED_BRANCH_PREFIXES = [
  AGENT_BRANCH_PREFIX,
  "thally/track-vnext/",
] as const;

/** Return whether a branch or full `refs/heads/` ref belongs to Track. */
export function isTrackOwnedBranch(ref: string | null | undefined): boolean {
  if (typeof ref !== "string") return false;
  const branch = ref.startsWith("refs/heads/")
    ? ref.slice("refs/heads/".length)
    : ref;
  return TRACK_OWNED_BRANCH_PREFIXES.some((prefix) =>
    branch.startsWith(prefix),
  );
}

/** Label that turns an OPEN PR into a preview-docs request (shared by the
 * webhook relay and the scaffolded sender workflow). */
export const DOCS_PREVIEW_LABEL = "docs-preview";

export interface PrFile {
  filename: string;
  /** GitHub status: added | removed | modified | renamed | … */
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff hunk; absent for binary or very large files. */
  patch?: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  /** The branch the PR merged INTO. */
  baseRef: string;
  /** The merge commit SHA, when merged. */
  mergeCommitSha?: string;
  author?: string;
  /** The branch the change was made on (head/source branch), when known. */
  sourceRef?: string;
  /** ISO timestamp of the merge, when merged. */
  mergedAt?: string;
}

/**
 * Compile a `**`-aware glob to an anchored RegExp: `**` crosses path segments,
 * `*` matches within one segment, `?` a single character. No negation or braces.
 */
function compileGlob(pattern: string): RegExp {
  const normalized = pattern.replace(/^\.\//, "");
  let regex = "";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        // `**/` may match zero directories; bare `**` matches anything.
        if (normalized[i + 2] === "/") {
          regex += "(?:[^/]+/)*";
          i += 2;
        } else {
          regex += ".*";
          i += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (char === "?") {
      regex += "[^/]";
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`);
}

/** Single glob check (compiles on each call — use filterFilesByGlobs for many files). */
export function matchesGlob(pattern: string, filePath: string): boolean {
  return compileGlob(pattern).test(filePath.replace(/^\.\//, ""));
}

/**
 * Filter files by path globs; absent/empty globs match everything. Each glob is
 * compiled once (M compilations), not once per file (N×M) — matters on large
 * PRs handled in the webhook request path.
 */
export function filterFilesByGlobs<T extends { filename: string }>(
  files: Array<T>,
  globs?: Array<string>,
): Array<T> {
  if (!globs || globs.length === 0) return files;
  const compiled = globs.map(compileGlob);
  return files.filter((file) => {
    const path = file.filename.replace(/^\.\//, "");
    return compiled.some((re) => re.test(path));
  });
}

/**
 * A tracked repository as Track consumes it. Alias of the shared docs.json
 * shape: `provider` and `host` are optional, so GitHub-only callers are unchanged.
 */
export type TrackedRepoLike = TrackedRepoConfig;

/** Provider of a tracked repository; entries without one are GitHub. */
function trackProvider(repo: Pick<TrackedRepoLike, "provider">): "github" | "gitlab" {
  return repo.provider === "gitlab" ? "gitlab" : "github";
}

/** A change identified by its request number, or only by a merge commit. */
export type TrackChangeRef = Pick<PullRequestInfo, "number"> | { ref: string };

/** Same context budget the agent's other context builders use. */
export const TRACK_CONTEXT_CHAR_CAP = 20000;

/**
 * The one-line instruction for a merged tracked PR. Pure (no network) and free
 * of shell-metacharacter wrapping — it is dispatched through GitHub Actions
 * where it lands in a shell, so it must never embed quotes that could break (or
 * be injected into) the run script; the receiver reads it from an env var. The
 * PR title is NOT embedded (it's attacker-influenced and the docs-repo Action
 * rebuilds full context from --from-pr anyway).
 *
 * The instruction frames the agent's actual job: judge what user-facing
 * behavior the merged PR changed and update the docs that describe it.
 */
export function buildTrackInstruction(
  repo: TrackedRepoLike,
  pr: TrackChangeRef,
  options?: { preview?: boolean },
): string {
  const provider = trackProvider(repo);
  const noun = provider === "gitlab" ? "merge request" : "pull request";
  const shortNoun = provider === "gitlab" ? "MR" : "PR";
  const reference =
    "number" in pr
      ? pullRequestLabel(provider, pr.number)
      : `merge commit ${pr.ref}`;
  const placement = repo.outputTab
    ? ` If new pages are warranted, add them under the ${repo.outputTab} tab${repo.outputGroup ? ` (${repo.outputGroup} group)` : ""}.`
    : "";
  const lead = options?.preview
    ? `An OPEN ${noun} in ${repo.owner}/${repo.repo} (${reference}) is up for review.`
    : `A ${noun} merged in ${repo.owner}/${repo.repo} (${reference}).`;
  const tail = options?.preview
    ? ` This is a preview: the ${shortNoun} may still change before it merges, so draft the docs it will need for review alongside it.`
    : ` Make no change if the ${shortNoun} has no user-facing impact.`;
  return (
    `${lead}` +
    ` Review it and decide what user-facing behavior it changes (API surface, config, CLI, defaults, behavior).` +
    ` Then find the documentation pages that describe that behavior and update them so the docs match — editing existing pages in place where they already cover it.${placement}` +
    tail
  );
}

/** The capped markdown context for a merged tracked PR (title, body, file diffs). */
export function buildTrackContext(
  repo: Pick<TrackedRepoLike, "owner" | "repo" | "provider">,
  pr: PullRequestInfo,
  files: Array<PrFile>,
): string {
  const provider = trackProvider(repo);
  const header = [
    `# Merged ${provider === "gitlab" ? "MR" : "PR"} ${repo.owner}/${repo.repo}${pullRequestLabel(provider, pr.number)}: ${pr.title}`,
    pr.author ? `Author: ${pr.author}` : null,
    pr.htmlUrl ? `URL: ${pr.htmlUrl}` : null,
    "",
    pr.body?.trim() || "(no description)",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  // Reserve room for the truncation note so the final cap never slices it off.
  const NOTE_RESERVE = 100;
  let context = header;
  for (const file of files) {
    const section = [
      `### ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`,
      file.patch
        ? `\`\`\`diff\n${file.patch}\n\`\`\``
        : "_(no text diff — binary or too large)_",
      "",
    ].join("\n");
    if (
      context.length + section.length >
      TRACK_CONTEXT_CHAR_CAP - NOTE_RESERVE
    ) {
      context += `\n_(diff truncated — ${files.length} file(s) total)_\n`;
      break;
    }
    context += section;
  }
  return context.slice(0, TRACK_CONTEXT_CHAR_CAP);
}

/**
 * Distill a merged PR into the docs task the agent runs: a one-line instruction
 * (output routing) and a capped markdown context (PR description + diff).
 */
export function buildTrackTask(
  repo: TrackedRepoLike,
  pr: PullRequestInfo,
  files: Array<PrFile>,
): { instruction: string; context: string } {
  return {
    instruction: buildTrackInstruction(repo, pr),
    context: buildTrackContext(repo, pr, files),
  };
}


/**
 * Hosts declared through `THALLY_GIT_HOSTS` (legacy `DOX_GIT_HOSTS`), plus
 * the current GitLab CI server when running inside a GitLab pipeline so a
 * self-hosted instance is recognised without extra configuration.
 */
export function envGitHosts(env: NodeJS.ProcessEnv = process.env): Array<GitHostConfig> {
  const hosts = parseGitHostsEnv(env.THALLY_GIT_HOSTS || env.DOX_GIT_HOSTS);
  const ciHost = env.GITLAB_CI === "true" ? env.CI_SERVER_HOST?.trim() : undefined;
  if (ciHost && !hosts.some((entry) => entry.host === ciHost.toLowerCase())) {
    hosts.push(...parseGitHostsEnv(`${ciHost}=gitlab`));
  }
  return hosts;
}
