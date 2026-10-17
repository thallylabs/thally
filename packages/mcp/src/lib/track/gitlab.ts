// ---------------------------------------------------------------------------
// Thally Track — GitLab API access (gitlab.com and self-hosted instances).
//
// Reads merge requests into the same normalized DTOs the GitHub client
// produces, opens documentation merge requests, and triggers the docs
// project's pipeline. Every call accepts an injectable `fetchImpl` so tests
// can assert exact URLs without a network.
//
// Authentication precedence (one resolver for every call site):
//   explicit token → THALLY_GITLAB_TOKEN → DOX_GITLAB_TOKEN → GITLAB_TOKEN
//   → CI_JOB_TOKEN (sent as JOB-TOKEN; GitLab limits it to a few endpoints).
// Personal, project, and group access tokens are all accepted as Bearer tokens.
// ---------------------------------------------------------------------------

import type { RepositoryRef } from "@thallylabs/core/repository";
import type { PrFile, PullRequestInfo } from "./shared.js";

/** The parts of a repository reference the GitLab client needs. */
export type GitlabProjectRef = Pick<RepositoryRef, "apiBaseUrl" | "fullPath">;

export interface GitlabFetchOptions {
  /** Overrides the token resolver entirely (sent as a Bearer token). */
  token?: string;
  /** Pipeline trigger token for {@link triggerGitlabDocsPipeline}; never used for reads. */
  triggerToken?: string;
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** A resolved GitLab credential and the header it travels in. */
export interface GitlabToken {
  kind: "bearer" | "job";
  value: string;
}

function envValue(...names: Array<string>): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Resolve the GitLab API credential using the documented precedence. */
export function resolveGitlabToken(
  options?: Pick<GitlabFetchOptions, "token">,
): GitlabToken | undefined {
  if (options?.token) return { kind: "bearer", value: options.token };
  const token = envValue("THALLY_GITLAB_TOKEN", "DOX_GITLAB_TOKEN", "GITLAB_TOKEN");
  if (token) return { kind: "bearer", value: token };
  const job = envValue("CI_JOB_TOKEN");
  return job ? { kind: "job", value: job } : undefined;
}

/** Resolve the pipeline trigger token for dispatching docs tasks. */
export function resolveGitlabTriggerToken(
  options?: Pick<GitlabFetchOptions, "triggerToken">,
): string | undefined {
  return options?.triggerToken || envValue("THALLY_GITLAB_TRIGGER_TOKEN", "DOX_GITLAB_TRIGGER_TOKEN");
}

/** Request headers for a resolved token. */
export function gitlabAuthHeaders(token?: GitlabToken): Record<string, string> {
  if (!token) return {};
  return token.kind === "job"
    ? { "JOB-TOKEN": token.value }
    : { Authorization: `Bearer ${token.value}` };
}

/** GitLab's project id for API paths: the URL-encoded full namespace path. */
export function gitlabProjectId(ref: Pick<RepositoryRef, "fullPath">): string {
  return encodeURIComponent(ref.fullPath);
}

function projectUrl(ref: GitlabProjectRef, path: string): string {
  return `${ref.apiBaseUrl}/projects/${gitlabProjectId(ref)}${path}`;
}

async function gitlabRequest<T>(
  url: string,
  options: GitlabFetchOptions | undefined,
  init: RequestInit = {},
): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...gitlabAuthHeaders(resolveGitlabToken(options)),
    ...(init.headers as Record<string, string> | undefined),
  };
  const response = await fetchImpl(url, { ...init, headers });
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403 || response.status === 404
        ? " (private project or token scope? set THALLY_GITLAB_TOKEN with read_api, or api to open merge requests)"
        : "";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    throw new Error(`GitLab API ${response.status} for ${path}${hint}`);
  }
  return (await response.json()) as T;
}

interface RawMergeRequest {
  iid: number;
  title?: string;
  description?: string | null;
  web_url?: string;
  target_branch?: string;
  source_branch?: string;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
  merged_at?: string | null;
  author?: { username?: string } | null;
}

interface RawMergeRequestDiff {
  old_path?: string;
  new_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  too_large?: boolean;
  binary?: boolean;
  diff?: string;
}

function toPullRequestInfo(raw: RawMergeRequest): PullRequestInfo {
  const mergeCommitSha = raw.merge_commit_sha || raw.squash_commit_sha;
  return {
    number: raw.iid,
    title: raw.title ?? "",
    body: raw.description ?? "",
    htmlUrl: raw.web_url ?? "",
    baseRef: raw.target_branch ?? "main",
    ...(mergeCommitSha ? { mergeCommitSha } : {}),
    ...(raw.author?.username ? { author: raw.author.username } : {}),
    ...(raw.source_branch ? { sourceRef: raw.source_branch } : {}),
    ...(raw.merged_at ? { mergedAt: raw.merged_at } : {}),
  };
}

/** Count added and removed lines of a unified diff, ignoring file headers. */
function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

/** Map a merge-request diff entry onto the GitHub-vocabulary {@link PrFile}. */
function toPrFile(raw: RawMergeRequestDiff): PrFile {
  const status = raw.new_file
    ? "added"
    : raw.deleted_file
      ? "removed"
      : raw.renamed_file
        ? "renamed"
        : "modified";
  const diff = raw.too_large || raw.binary ? "" : (raw.diff ?? "");
  return {
    filename: raw.new_path,
    status,
    ...countDiffLines(diff),
    ...(diff ? { patch: diff } : {}),
  };
}

/** Fetch one merge request's metadata. */
export async function fetchGitlabMergeRequest(
  ref: GitlabProjectRef,
  iid: number,
  options?: GitlabFetchOptions,
): Promise<PullRequestInfo> {
  const raw = await gitlabRequest<RawMergeRequest>(
    projectUrl(ref, `/merge_requests/${iid}`),
    options,
  );
  return toPullRequestInfo(raw);
}

/**
 * Fetch a merge request's changed files with patches. Paginated like the
 * GitHub fetcher (100 per page, 30 pages) so a tracked path past the first
 * page is never missed.
 */
export async function fetchGitlabMergeRequestFiles(
  ref: GitlabProjectRef,
  iid: number,
  options?: GitlabFetchOptions,
): Promise<Array<PrFile>> {
  const perPage = 100;
  const maxPages = 30;
  const files: Array<PrFile> = [];
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await gitlabRequest<Array<RawMergeRequestDiff>>(
      projectUrl(ref, `/merge_requests/${iid}/diffs?per_page=${perPage}&page=${page}`),
      options,
    );
    files.push(...chunk.map(toPrFile));
    if (chunk.length < perPage) break;
  }
  return files;
}

/** The most recently merged merge request into `targetBranch`, or null. */
export async function fetchLatestMergedGitlabMergeRequest(
  ref: GitlabProjectRef,
  targetBranch: string,
  options?: GitlabFetchOptions,
): Promise<PullRequestInfo | null> {
  const raw = await gitlabRequest<Array<RawMergeRequest>>(
    projectUrl(
      ref,
      `/merge_requests?state=merged&target_branch=${encodeURIComponent(targetBranch)}&order_by=updated_at&sort=desc&per_page=30`,
    ),
    options,
  );
  // Like GitHub, `updated_at` is not merge order; pick the latest merge.
  const latest = raw
    .filter((mr) => Boolean(mr.merged_at))
    .sort((a, b) => Date.parse(b.merged_at ?? "") - Date.parse(a.merged_at ?? ""))[0];
  return latest ? toPullRequestInfo(latest) : null;
}

/**
 * Merge requests that introduced a commit. GitLab CI has no post-merge
 * merge-request event, so push-triggered senders dispatch a commit URL and
 * the receiver resolves the merge request here.
 */
export async function fetchGitlabMergeRequestsForCommit(
  ref: GitlabProjectRef,
  sha: string,
  options?: GitlabFetchOptions,
): Promise<Array<PullRequestInfo>> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error("Invalid commit SHA.");
  const raw = await gitlabRequest<Array<RawMergeRequest>>(
    projectUrl(ref, `/repository/commits/${sha}/merge_requests`),
    options,
  );
  return raw.map(toPullRequestInfo);
}

/** Open a merge request. Requires a token with `api` scope. */
export async function createGitlabMergeRequest(
  ref: GitlabProjectRef,
  input: { sourceBranch: string; targetBranch: string; title: string; description: string },
  options?: GitlabFetchOptions,
): Promise<{ url: string; number: number }> {
  const raw = await gitlabRequest<RawMergeRequest>(projectUrl(ref, "/merge_requests"), options, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_branch: input.sourceBranch,
      target_branch: input.targetBranch,
      title: input.title,
      description: input.description,
      remove_source_branch: true,
    }),
  });
  return { url: raw.web_url ?? "", number: raw.iid };
}

/**
 * Start the docs project's pipeline with task variables. Prefers a pipeline
 * trigger token (the narrowest credential); falls back to the pipelines API
 * with an access token that can run pipelines.
 */
export async function triggerGitlabDocsPipeline(
  ref: GitlabProjectRef,
  input: { ref: string; variables: Record<string, string> },
  options?: GitlabFetchOptions,
): Promise<void> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const triggerToken = resolveGitlabTriggerToken(options);
  if (triggerToken) {
    const form = new FormData();
    form.set("token", triggerToken);
    form.set("ref", input.ref);
    for (const [key, value] of Object.entries(input.variables)) {
      form.set(`variables[${key}]`, value);
    }
    const response = await fetchImpl(projectUrl(ref, "/trigger/pipeline"), {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new Error(
        `GitLab pipeline trigger failed (${response.status}) — check THALLY_GITLAB_TRIGGER_TOKEN and that "${input.ref}" exists in ${ref.fullPath}.`,
      );
    }
    return;
  }
  const token = resolveGitlabToken(options);
  if (!token || token.kind !== "bearer") {
    throw new Error(
      "Set THALLY_GITLAB_TRIGGER_TOKEN (the docs project's pipeline trigger token) or THALLY_GITLAB_TOKEN (api scope) to dispatch docs tasks.",
    );
  }
  await gitlabRequest(projectUrl(ref, "/pipeline"), options, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: input.ref,
      variables: Object.entries(input.variables).map(([key, value]) => ({ key, value })),
    }),
  });
}
