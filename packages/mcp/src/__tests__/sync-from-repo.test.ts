import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSyncFromRepo } from "../tools/sync-from-repo.js";

type Call = { url: string; init?: RequestInit };

/** Route fake responses by URL substring so each endpoint gets a realistic payload. */
function routedFetch(routes: Array<[string, unknown]>, calls: Array<Call>) {
  return (async (url: unknown, init?: unknown) => {
    const href = String(url);
    calls.push({ url: href, init: init as RequestInit });
    const match = routes.find(([fragment]) => href.includes(fragment));
    return { ok: true, status: 200, json: async () => match?.[1] ?? {} } as Response;
  }) as typeof fetch;
}

let projectDir: string;
const saved: Record<string, string | undefined> = {};
const ENV = ["THALLY_GITLAB_TOKEN", "THALLY_GITLAB_TRIGGER_TOKEN", "THALLY_GIT_HOSTS", "DOX_GIT_HOSTS", "CI_JOB_TOKEN"];

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "thally-sync-"));
  for (const name of ENV) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function writeDocsJson(config: unknown) {
  writeFileSync(join(projectDir, "docs.json"), JSON.stringify(config));
}

describe("sync_from_repo with GitLab", () => {
  it("previews a tracked GitLab merge request", async () => {
    writeDocsJson({
      tracking: { repos: [{ owner: "acme/platform", repo: "api", provider: "gitlab", paths: ["src/**"] }] },
    });
    const calls: Array<Call> = [];
    const fetchImpl = routedFetch(
      [
        ["/diffs", [{ new_path: "src/a.ts", diff: "+x\n" }, { new_path: "README.md", diff: "+y\n" }]],
        ["/merge_requests?state=merged", [{ iid: 8, title: "Limits", merged_at: "2026-10-01T00:00:00Z", web_url: "https://gitlab.com/acme/platform/api/-/merge_requests/8" }]],
      ],
      calls,
    );
    const out = await handleSyncFromRepo({ projectDir, dryRun: true }, { fetchImpl });
    expect(calls[0].url).toContain("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests?state=merged&target_branch=main");
    expect(out).toContain("Dry run — docs task for acme/platform/api!8");
    expect(out).toContain("Files matched: 1 of 2 (src/a.ts)");
  });

  it("dispatches to a GitLab docs project through a pipeline trigger", async () => {
    process.env.THALLY_GITLAB_TRIGGER_TOKEN = "trig";
    writeDocsJson({ tracking: { repos: [{ owner: "acme", repo: "api", provider: "gitlab" }] } });
    const calls: Array<Call> = [];
    const fetchImpl = routedFetch(
      [
        ["/diffs", [{ new_path: "src/a.ts", diff: "+x\n" }]],
        ["/merge_requests/3", { iid: 3, title: "T", web_url: "https://gitlab.com/acme/api/-/merge_requests/3" }],
      ],
      calls,
    );
    const out = await handleSyncFromRepo(
      { projectDir, pr: 3, dryRun: false, docsRepo: "https://gitlab.com/acme/docs", docsRef: "main" },
      { fetchImpl },
    );
    const trigger = calls.find((call) => call.url.endsWith("/trigger/pipeline"));
    expect(trigger?.url).toBe("https://gitlab.com/api/v4/projects/acme%2Fdocs/trigger/pipeline");
    const form = trigger?.init?.body as FormData;
    expect(form.get("variables[FROM_PR]")).toBe("https://gitlab.com/acme/api/-/merge_requests/3");
    expect(form.get("variables[INSTRUCTION]")).toContain("(!3)");
    expect(out).toContain("Dispatched docs task for acme/api!3 to acme/docs");
  });

  it("matches a self-hosted tracked repository declared in docs.json", async () => {
    writeDocsJson({
      repository: { hosts: [{ host: "git.example.com", provider: "gitlab" }] },
      tracking: {
        repos: [
          { owner: "acme", repo: "api" },
          { owner: "team", repo: "app", host: "git.example.com", branch: "develop" },
        ],
      },
    });
    const calls: Array<Call> = [];
    const fetchImpl = routedFetch([["/merge_requests?state=merged", []]], calls);
    const out = await handleSyncFromRepo(
      { projectDir, repo: "https://git.example.com/team/app", dryRun: true },
      { fetchImpl },
    );
    expect(calls[0].url).toContain("https://git.example.com/api/v4/projects/team%2Fapp/merge_requests?state=merged&target_branch=develop");
    expect(out).toBe("No merged merge requests found on team/app@develop.");
  });

  it("keeps GitHub dispatch on repository_dispatch", async () => {
    writeDocsJson({ tracking: { repos: [{ owner: "acme", repo: "api" }] } });
    const savedToken = process.env.THALLY_GITHUB_TOKEN;
    process.env.THALLY_GITHUB_TOKEN = "gh";
    try {
      const calls: Array<Call> = [];
      const fetchImpl = routedFetch(
        [
          ["/files", [{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 0 }]],
          ["/pulls/5", { number: 5, title: "T", html_url: "https://github.com/acme/api/pull/5" }],
        ],
        calls,
      );
      await handleSyncFromRepo({ projectDir, pr: 5, dryRun: false, docsRepo: "acme/docs" }, { fetchImpl });
      const dispatch = calls.find((call) => call.url.endsWith("/dispatches"));
      expect(dispatch?.url).toBe("https://api.github.com/repos/acme/docs/dispatches");
      expect(JSON.parse(String(dispatch?.init?.body)).client_payload).toEqual({
        instruction: expect.stringContaining("(#5)"),
        from_pr: "https://github.com/acme/api/pull/5",
      });
    } finally {
      if (savedToken === undefined) delete process.env.THALLY_GITHUB_TOKEN;
      else process.env.THALLY_GITHUB_TOKEN = savedToken;
    }
  });
});
