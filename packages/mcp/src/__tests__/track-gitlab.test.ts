import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRepositoryReference, resolveGitHosts } from "@thallylabs/core/repository";
import {
  buildTrackContext,
  buildTrackInstruction,
  createGitlabMergeRequest,
  fetchGitlabMergeRequest,
  fetchGitlabMergeRequestFiles,
  fetchGitlabMergeRequestsForCommit,
  fetchLatestMergedGitlabMergeRequest,
  resolveGitlabToken,
  triggerGitlabDocsPipeline,
} from "../lib/track.js";

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: Array<{ status?: number; json: unknown }>, calls: Array<Call> = []) {
  let index = 0;
  const impl = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const status = response.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => response.json } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

const project = parseRepositoryReference("https://gitlab.com/acme/platform/api")!;
const TOKEN_ENV = ["THALLY_GITLAB_TOKEN", "DOX_GITLAB_TOKEN", "GITLAB_TOKEN", "CI_JOB_TOKEN", "THALLY_GITLAB_TRIGGER_TOKEN", "DOX_GITLAB_TRIGGER_TOKEN"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(TOKEN_ENV.map((name) => [name, process.env[name]]));
  for (const name of TOKEN_ENV) delete process.env[name];
});
afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("GitLab merge request reads", () => {
  it("fetches a merge request by iid with an encoded project path", async () => {
    process.env.THALLY_GITLAB_TOKEN = "t0k";
    const { impl, calls } = fakeFetch([
      {
        json: {
          iid: 42,
          title: "Add rate limits",
          description: "Body",
          web_url: "https://gitlab.com/acme/platform/api/-/merge_requests/42",
          target_branch: "main",
          source_branch: "feature/limits",
          merge_commit_sha: null,
          squash_commit_sha: "abc123",
          merged_at: "2026-10-01T00:00:00Z",
          author: { username: "ada" },
        },
      },
    ]);
    const mr = await fetchGitlabMergeRequest(project, 42, { fetchImpl: impl });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/42");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer t0k");
    expect(mr).toEqual({
      number: 42,
      title: "Add rate limits",
      body: "Body",
      htmlUrl: "https://gitlab.com/acme/platform/api/-/merge_requests/42",
      baseRef: "main",
      mergeCommitSha: "abc123",
      author: "ada",
      sourceRef: "feature/limits",
      mergedAt: "2026-10-01T00:00:00Z",
    });
  });

  it("uses the self-hosted API base and the CI job token header", async () => {
    process.env.CI_JOB_TOKEN = "job";
    const selfHosted = parseRepositoryReference("https://git.example.com/team/app", {
      hosts: resolveGitHosts([{ host: "git.example.com", provider: "gitlab" }]),
    })!;
    const { impl, calls } = fakeFetch([{ json: { iid: 1 } }]);
    await fetchGitlabMergeRequest(selfHosted, 1, { fetchImpl: impl });
    expect(calls[0].url).toBe("https://git.example.com/api/v4/projects/team%2Fapp/merge_requests/1");
    expect(calls[0].init?.headers).toMatchObject({ "JOB-TOKEN": "job" });
  });

  it("maps diff statuses, counts lines, and paginates", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ new_path: `docs/${i}.md`, diff: "+a\n" }));
    const page2 = [
      { new_path: "src/new.ts", new_file: true, diff: "--- a\n+++ b\n+one\n+two\n-old\n" },
      { new_path: "src/gone.ts", deleted_file: true, diff: "-x\n" },
      { old_path: "a.ts", new_path: "b.ts", renamed_file: true, diff: "" },
      { new_path: "big.bin", too_large: true, diff: "+huge" },
    ];
    const { impl, calls } = fakeFetch([{ json: page1 }, { json: page2 }]);
    const files = await fetchGitlabMergeRequestFiles(project, 7, { fetchImpl: impl });
    expect(calls.map((call) => call.url)).toEqual([
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/7/diffs?per_page=100&page=1",
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/7/diffs?per_page=100&page=2",
    ]);
    expect(files).toHaveLength(104);
    expect(files.slice(100)).toEqual([
      { filename: "src/new.ts", status: "added", additions: 2, deletions: 1, patch: "--- a\n+++ b\n+one\n+two\n-old\n" },
      { filename: "src/gone.ts", status: "removed", additions: 0, deletions: 1, patch: "-x\n" },
      { filename: "b.ts", status: "renamed", additions: 0, deletions: 0 },
      { filename: "big.bin", status: "modified", additions: 0, deletions: 0 },
    ]);
  });

  it("picks the most recently merged request, not the most recently updated", async () => {
    const { impl, calls } = fakeFetch([
      {
        json: [
          { iid: 1, merged_at: "2026-09-01T00:00:00Z" },
          { iid: 2, merged_at: "2026-10-01T00:00:00Z" },
          { iid: 3, merged_at: null },
        ],
      },
    ]);
    const latest = await fetchLatestMergedGitlabMergeRequest(project, "release/1", { fetchImpl: impl });
    expect(calls[0].url).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests?state=merged&target_branch=release%2F1&order_by=updated_at&sort=desc&per_page=30",
    );
    expect(latest?.number).toBe(2);
  });

  it("resolves merge requests for a commit and rejects invalid SHAs", async () => {
    const { impl, calls } = fakeFetch([{ json: [{ iid: 9, source_branch: "thally/agent-x" }] }]);
    const found = await fetchGitlabMergeRequestsForCommit(project, "abcdef1", { fetchImpl: impl });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/repository/commits/abcdef1/merge_requests");
    expect(found[0]).toMatchObject({ number: 9, sourceRef: "thally/agent-x" });
    await expect(fetchGitlabMergeRequestsForCommit(project, "../x", { fetchImpl: impl })).rejects.toThrow("Invalid commit SHA");
  });

  it("explains authorization failures", async () => {
    const { impl } = fakeFetch([{ status: 404, json: {} }]);
    await expect(fetchGitlabMergeRequest(project, 1, { fetchImpl: impl })).rejects.toThrow(/THALLY_GITLAB_TOKEN/);
  });
});

describe("GitLab writes", () => {
  it("opens a merge request with the agent's branch and body", async () => {
    const { impl, calls } = fakeFetch([{ json: { iid: 5, web_url: "https://gitlab.com/acme/platform/api/-/merge_requests/5" } }]);
    const created = await createGitlabMergeRequest(
      project,
      { sourceBranch: "thally/agent-1", targetBranch: "main", title: "docs: x", description: "body" },
      { fetchImpl: impl, token: "explicit" },
    );
    expect(created).toEqual({ url: "https://gitlab.com/acme/platform/api/-/merge_requests/5", number: 5 });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      source_branch: "thally/agent-1",
      target_branch: "main",
      title: "docs: x",
      description: "body",
      remove_source_branch: true,
    });
  });

  it("triggers the docs pipeline with a trigger token and form variables", async () => {
    process.env.THALLY_GITLAB_TRIGGER_TOKEN = "trig";
    const { impl, calls } = fakeFetch([{ json: { id: 1 } }]);
    await triggerGitlabDocsPipeline(project, { ref: "main", variables: { INSTRUCTION: "do it", FROM_PR: "u" } }, { fetchImpl: impl });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/trigger/pipeline");
    const form = calls[0].init?.body as FormData;
    expect(form.get("token")).toBe("trig");
    expect(form.get("ref")).toBe("main");
    expect(form.get("variables[INSTRUCTION]")).toBe("do it");
    expect(form.get("variables[FROM_PR]")).toBe("u");
  });

  it("falls back to the pipelines API with an access token", async () => {
    process.env.THALLY_GITLAB_TOKEN = "t";
    const { impl, calls } = fakeFetch([{ json: { id: 1 } }]);
    await triggerGitlabDocsPipeline(project, { ref: "docs", variables: { INSTRUCTION: "i" } }, { fetchImpl: impl });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/pipeline");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ref: "docs", variables: [{ key: "INSTRUCTION", value: "i" }] });
  });

  it("refuses to dispatch without a trigger or access token", async () => {
    process.env.CI_JOB_TOKEN = "job-only";
    const { impl } = fakeFetch([{ json: {} }]);
    await expect(triggerGitlabDocsPipeline(project, { ref: "main", variables: {} }, { fetchImpl: impl })).rejects.toThrow(
      /THALLY_GITLAB_TRIGGER_TOKEN/,
    );
  });
});

describe("token resolution", () => {
  it("prefers explicit, then THALLY_, then DOX_, then GITLAB_TOKEN, then the job token", () => {
    process.env.CI_JOB_TOKEN = "job";
    expect(resolveGitlabToken()).toEqual({ kind: "job", value: "job" });
    process.env.GITLAB_TOKEN = "plain";
    expect(resolveGitlabToken()).toEqual({ kind: "bearer", value: "plain" });
    process.env.DOX_GITLAB_TOKEN = "dox";
    expect(resolveGitlabToken()).toEqual({ kind: "bearer", value: "dox" });
    process.env.THALLY_GITLAB_TOKEN = "thally";
    expect(resolveGitlabToken()).toEqual({ kind: "bearer", value: "thally" });
    expect(resolveGitlabToken({ token: "explicit" })).toEqual({ kind: "bearer", value: "explicit" });
  });
});

describe("GitLab Track instructions", () => {
  const repo = { owner: "acme/platform", repo: "api", provider: "gitlab" as const };

  it("names merge requests with ! references", () => {
    expect(buildTrackInstruction(repo, { number: 4 })).toMatch(/^A merge request merged in acme\/platform\/api \(!4\)\./);
    expect(buildTrackInstruction(repo, { number: 4 }, { preview: true })).toContain("the MR may still change");
    expect(buildTrackInstruction(repo, { ref: "abc1234" })).toContain("(merge commit abc1234)");
  });

  it("titles the context as a merged MR", () => {
    const context = buildTrackContext(repo, { number: 4, title: "T", body: "", htmlUrl: "", baseRef: "main" }, []);
    expect(context.split("\n")[0]).toBe("# Merged MR acme/platform/api!4: T");
  });

  it("keeps GitHub wording unchanged", () => {
    expect(buildTrackInstruction({ owner: "a", repo: "b" }, { number: 4 })).toMatch(
      /^A pull request merged in a\/b \(#4\)\. .* Make no change if the PR has no user-facing impact\.$/,
    );
  });
});
