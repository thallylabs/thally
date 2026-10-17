// ---------------------------------------------------------------------------
// Thally Track — one client interface over GitHub and GitLab.
//
// Callers (`thally track test`, `sync_from_repo`, the docs agent) pick a
// client from a repository reference and stop branching on the provider.
// The GitHub client wraps the long-standing fetchers, so its URLs, auth
// chain, and behaviour are unchanged.
// ---------------------------------------------------------------------------

import { pullRequestLabel, type RepositoryRef } from "@thallylabs/core/repository";
import {
  fetchLatestMergedPr,
  fetchPullRequest,
  fetchPullRequestFiles,
  resolveGithubToken,
  type GithubFetchOptions,
} from "./github.js";
import {
  createGitlabMergeRequest,
  fetchGitlabMergeRequest,
  fetchGitlabMergeRequestFiles,
  fetchGitlabMergeRequestsForCommit,
  fetchLatestMergedGitlabMergeRequest,
  triggerGitlabDocsPipeline,
  type GitlabFetchOptions,
} from "./gitlab.js";
import type { PrFile, PullRequestInfo } from "./shared.js";

/** A docs task sent to the docs repository's agent pipeline or workflow. */
export interface DocsTaskDispatch {
  event: "thally-document" | "thally-readiness";
  instruction: string;
  /** URL of the product pull/merge request (or merge commit) for context. */
  fromPr?: string;
  requester?: string;
  preview?: boolean;
  /** Pre-resolved context; omitted by default so payloads stay small. */
  context?: string;
  /** Docs branch to run on. GitLab requires one (default `main`); GitHub ignores it. */
  ref?: string;
}

/** Provider-neutral Track operations for one repository. */
export interface TrackClient {
  readonly provider: RepositoryRef["provider"];
  readonly ref: RepositoryRef;
  fetchPullRequest(number: number): Promise<PullRequestInfo>;
  fetchPullRequestFiles(number: number): Promise<Array<PrFile>>;
  fetchLatestMergedPr(base: string): Promise<PullRequestInfo | null>;
  /** Requests that introduced a commit. GitHub returns [] (its senders always know the PR). */
  fetchPullRequestsForCommit(sha: string): Promise<Array<PullRequestInfo>>;
  /** Send a docs task to `docsRef` using the same provider's dispatch mechanism. */
  dispatchDocsTask(docsRef: RepositoryRef, payload: DocsTaskDispatch): Promise<void>;
  /** Open a request in this repository. GitHub opening stays on the `gh` CLI in the agent. */
  createPullRequest(input: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number }>;
  /** `#42` or `!42`. */
  label(number: number): string;
}

/** Options for {@link createTrackClient}; each provider reads its own fields. */
export type TrackClientOptions = GithubFetchOptions & Omit<GitlabFetchOptions, "token" | "fetchImpl">;

function createGithubTrackClient(ref: RepositoryRef, options: TrackClientOptions): TrackClient {
  const [owner, repo] = [ref.owner, ref.repo];
  return {
    provider: "github",
    ref,
    fetchPullRequest: (number) => fetchPullRequest(owner, repo, number, options),
    fetchPullRequestFiles: (number) => fetchPullRequestFiles(owner, repo, number, options),
    fetchLatestMergedPr: (base) => fetchLatestMergedPr(owner, repo, base, options),
    fetchPullRequestsForCommit: async () => [],
    async dispatchDocsTask(docsRef, payload) {
      const token = await resolveGithubToken(options);
      if (!token) {
        throw new Error(
          "Set THALLY_GITHUB_TOKEN (or connect a GitHub App) with dispatch access to the docs repo to dispatch a docs task.",
        );
      }
      const fetchImpl = options.fetchImpl ?? fetch;
      const clientPayload: Record<string, string | boolean> = { instruction: payload.instruction };
      if (payload.fromPr) clientPayload.from_pr = payload.fromPr;
      if (payload.requester) clientPayload.requester = payload.requester;
      if (payload.preview !== undefined) clientPayload.preview = payload.preview;
      if (payload.context) clientPayload.context = payload.context;
      const response = await fetchImpl(`${docsRef.apiBaseUrl}/repos/${docsRef.fullPath}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_type: payload.event, client_payload: clientPayload }),
      });
      if (!response.ok) {
        throw new Error(
          `repository_dispatch failed (${response.status}) — check the token's access to ${docsRef.fullPath}.`,
        );
      }
    },
    async createPullRequest() {
      throw new Error("Opening GitHub pull requests uses the gh CLI in the docs agent.");
    },
    label: (number) => pullRequestLabel("github", number),
  };
}

function createGitlabTrackClient(ref: RepositoryRef, options: TrackClientOptions): TrackClient {
  // GitHub tokens never leak into GitLab requests: only provider-neutral options pass through.
  const gitlabOptions: GitlabFetchOptions = {
    fetchImpl: options.fetchImpl,
    triggerToken: options.triggerToken,
  };
  return {
    provider: "gitlab",
    ref,
    fetchPullRequest: (number) => fetchGitlabMergeRequest(ref, number, gitlabOptions),
    fetchPullRequestFiles: (number) => fetchGitlabMergeRequestFiles(ref, number, gitlabOptions),
    fetchLatestMergedPr: (base) => fetchLatestMergedGitlabMergeRequest(ref, base, gitlabOptions),
    fetchPullRequestsForCommit: (sha) => fetchGitlabMergeRequestsForCommit(ref, sha, gitlabOptions),
    async dispatchDocsTask(docsRef, payload) {
      const variables: Record<string, string> = {
        THALLY_EVENT: payload.event,
        INSTRUCTION: payload.instruction,
      };
      if (payload.fromPr) variables.FROM_PR = payload.fromPr;
      if (payload.requester) variables.REQUESTER = payload.requester;
      if (payload.preview !== undefined) variables.PREVIEW = String(payload.preview);
      if (payload.context) variables.TRACK_CONTEXT = payload.context;
      await triggerGitlabDocsPipeline(docsRef, { ref: payload.ref || "main", variables }, gitlabOptions);
    },
    createPullRequest: (input) =>
      createGitlabMergeRequest(
        ref,
        {
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
          title: input.title,
          description: input.body,
        },
        gitlabOptions,
      ),
    label: (number) => pullRequestLabel("gitlab", number),
  };
}

/** Choose the Track client for a repository's provider. */
export function createTrackClient(ref: RepositoryRef, options: TrackClientOptions = {}): TrackClient {
  return ref.provider === "gitlab"
    ? createGitlabTrackClient(ref, options)
    : createGithubTrackClient(ref, options);
}
