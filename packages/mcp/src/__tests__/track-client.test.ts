import { describe, expect, it } from "vitest";
import { parseRepositoryReference } from "@thallylabs/core/repository";
import { createTrackClient } from "../lib/track.js";

type Call = { url: string; init?: RequestInit };

function fakeFetch(json: unknown, calls: Array<Call>) {
  return (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return { ok: true, status: 200, json: async () => json } as Response;
  }) as typeof fetch;
}

describe("createTrackClient", () => {
  it("routes GitHub repositories to the existing REST endpoints", async () => {
    const calls: Array<Call> = [];
    const client = createTrackClient(parseRepositoryReference("acme/api")!, {
      token: "gh",
      fetchImpl: fakeFetch({ number: 42, title: "t" }, calls),
    });
    expect(client.provider).toBe("github");
    expect(client.label(42)).toBe("#42");
    await client.fetchPullRequest(42);
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/api/pulls/42");
    expect(await client.fetchPullRequestsForCommit("abcdef1")).toEqual([]);
  });

  it("routes GitLab repositories to the v4 API", async () => {
    const calls: Array<Call> = [];
    const client = createTrackClient(parseRepositoryReference("group/sub/api")!, {
      fetchImpl: fakeFetch({ iid: 3 }, calls),
    });
    expect(client.provider).toBe("gitlab");
    expect(client.label(3)).toBe("!3");
    await client.fetchPullRequest(3);
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/group%2Fsub%2Fapi/merge_requests/3");
  });

  it("dispatches GitHub docs tasks through repository_dispatch", async () => {
    const calls: Array<Call> = [];
    const docs = parseRepositoryReference("acme/docs")!;
    const client = createTrackClient(docs, { token: "gh", fetchImpl: fakeFetch({}, calls) });
    await client.dispatchDocsTask(docs, { event: "thally-document", instruction: "Do it", fromPr: "https://x/pull/1" });
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/docs/dispatches");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      event_type: "thally-document",
      client_payload: { instruction: "Do it", from_pr: "https://x/pull/1" },
    });
  });

  it("dispatches GitLab docs tasks through a pipeline trigger", async () => {
    const calls: Array<Call> = [];
    const docs = parseRepositoryReference("https://gitlab.com/acme/docs")!;
    const client = createTrackClient(docs, { triggerToken: "trig", fetchImpl: fakeFetch({}, calls) });
    await client.dispatchDocsTask(docs, { event: "thally-document", instruction: "Do it", preview: true, ref: "docs" });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/acme%2Fdocs/trigger/pipeline");
    const form = calls[0].init?.body as FormData;
    expect(form.get("ref")).toBe("docs");
    expect(form.get("variables[THALLY_EVENT]")).toBe("thally-document");
    expect(form.get("variables[INSTRUCTION]")).toBe("Do it");
    expect(form.get("variables[PREVIEW]")).toBe("true");
  });

  it("never sends a GitHub token to GitLab", async () => {
    const calls: Array<Call> = [];
    const saved = process.env.THALLY_GITLAB_TOKEN;
    delete process.env.THALLY_GITLAB_TOKEN;
    try {
      const client = createTrackClient(parseRepositoryReference("g/s/p")!, {
        token: "github-secret",
        fetchImpl: fakeFetch({ iid: 1 }, calls),
      });
      await client.fetchPullRequest(1);
      expect(JSON.stringify(calls[0].init?.headers)).not.toContain("github-secret");
    } finally {
      if (saved !== undefined) process.env.THALLY_GITLAB_TOKEN = saved;
    }
  });
});
