import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { buildToolBridge } from "../tools.js";
import {
  agentWriteToolTargets,
  assertAgentWritePolicySatisfied,
  parseAgentWritePolicy,
  readAgentWritePolicyFile,
  type AgentWritePolicyV2,
  type AgentWritePolicyV1,
} from "../write-policy.js";
import { MAX_AGENT_WRITE_POLICY_FILE_BYTES } from "../write-policy-contract.js";

const temporaryDirectories: Array<string> = [];

function git(cwd: string, args: Array<string>): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function repository(): string {
  const directory = mkdtempSync(join(tmpdir(), "thally-agent-policy-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "src", "content"), { recursive: true });
  writeFileSync(
    join(directory, "src", "content", "api.mdx"),
    "---\ntitle: API\n---\n\nOld\n",
  );
  writeFileSync(
    join(directory, "src", "content", "guide.mdx"),
    "---\ntitle: Guide\n---\n\nOld\n",
  );
  writeFileSync(
    join(directory, "docs.json"),
    JSON.stringify({
      tabs: [
        {
          tab: "Docs",
          groups: [{ group: "Guides", pages: ["api", "guide"] }],
        },
      ],
    }),
  );
  git(directory, ["init"]);
  git(directory, ["config", "user.name", "Thally Test"]);
  git(directory, ["config", "user.email", "test@example.invalid"]);
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "-m", "test: seed docs"]);
  return directory;
}

function policy(
  overrides: Partial<AgentWritePolicyV1> = {},
): AgentWritePolicyV1 {
  return {
    version: 1,
    requiredPaths: ["src/content/api.mdx"],
    requiredChangeIds: ["change-1"],
    maximumFiles: 1,
    maximumBytes: 4_096,
    ...overrides,
  };
}

function revisionPolicy(
  overrides: Partial<AgentWritePolicyV2> = {},
): AgentWritePolicyV2 {
  return {
    version: 2,
    requiredPaths: ["src/content/api.mdx", "src/content/guide.mdx"],
    requiredChangeIds: ["change-1", "change-2"],
    maximumFiles: 2,
    maximumBytes: 4_096,
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("agent write policy parsing", () => {
  it("canonicalizes an exact bounded policy", () => {
    const parsed = parseAgentWritePolicy(
      policy({
        requiredPaths: ["src/content/z.mdx", "src/content/a.mdx"],
        requiredChangeIds: ["change-z", "change-a"],
        maximumFiles: 2,
      }),
    );
    expect(parsed).toMatchObject({
      requiredPaths: ["src/content/a.mdx", "src/content/z.mdx"],
      requiredChangeIds: ["change-a", "change-z"],
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.requiredPaths)).toBe(true);
  });

  it.each([
    { ...policy(), extra: true },
    policy({ requiredPaths: ["../secret"] }),
    policy({ requiredPaths: [".git/config"] }),
    policy({ requiredPaths: [".Git/config"] }),
    policy({
      requiredPaths: ["src/content/api.mdx", "src/content/api.mdx"],
      maximumFiles: 2,
    }),
    policy({ requiredChangeIds: ["change-1", "change-1"] }),
    policy({ maximumFiles: 0 }),
    policy({ maximumBytes: 4 * 1024 * 1024 + 1 }),
  ])("rejects malformed or over-broad input", (value) => {
    expect(parseAgentWritePolicy(value)).toBeNull();
  });

  it("accepts the maximum valid 500-path and 500-change policy", () => {
    const directory = repository();
    const path = join(directory, "policy.json");
    const requiredPaths = Array.from(
      { length: 500 },
      (_, index) => `${'"'.repeat(508)}/${index.toString().padStart(3, "0")}`,
    );
    const requiredChangeIds = Array.from(
      { length: 500 },
      (_, index) => `c${index.toString().padStart(3, "0")}${"x".repeat(124)}`,
    );
    const maximum = policy({
      requiredPaths,
      requiredChangeIds,
      maximumFiles: 500,
    });
    const encoded = JSON.stringify(maximum);
    expect(Buffer.byteLength(encoded, "utf8")).toBeGreaterThan(64 * 1024);
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(
      MAX_AGENT_WRITE_POLICY_FILE_BYTES,
    );
    writeFileSync(path, encoded);
    expect(readAgentWritePolicyFile(path)).toMatchObject({
      requiredPaths: [...requiredPaths].sort(),
      requiredChangeIds: [...requiredChangeIds].sort(),
    });
  });

  it("rejects files beyond the derived policy contract ceiling", () => {
    const directory = repository();
    const path = join(directory, "policy.json");
    writeFileSync(path, "x".repeat(MAX_AGENT_WRITE_POLICY_FILE_BYTES + 1));
    expect(() => readAgentWritePolicyFile(path)).toThrow(
      "agent_write_policy_invalid",
    );
  });

  it("rejects a symlinked policy file", () => {
    const directory = repository();
    const target = join(directory, "policy-target.json");
    const link = join(directory, "policy.json");
    writeFileSync(target, JSON.stringify(policy()));
    symlinkSync(target, link);
    expect(() => readAgentWritePolicyFile(link)).toThrow(
      "agent_write_policy_invalid",
    );
  });
});

describe("agent tool write authority", () => {
  it("fails closed for a future unclassified tool", () => {
    expect(agentWriteToolTargets(".", "future_write_tool", {})).toBeNull();
  });

  it("allows the exact existing page and blocks every other page before mutation", async () => {
    const directory = repository();
    const parsed = parseAgentWritePolicy(policy())!;
    const bridge = buildToolBridge(directory, { writePolicy: parsed });

    const rejected = await bridge.dispatch("update_page", {
      pageId: "other",
      content: "Nope",
    });
    expect(rejected).toBe(
      "Error: this write is outside the controller-approved documentation plan.",
    );
    expect(
      readFileSync(join(directory, "src", "content", "api.mdx"), "utf8"),
    ).toContain("Old");

    const accepted = await bridge.dispatch("update_page", {
      pageId: "api",
      content: "New",
    });
    expect(accepted).toContain("Page updated");
  });

  it("requires both the new page and docs.json before add_page can run", async () => {
    const directory = repository();
    const denied = buildToolBridge(directory, {
      writePolicy: parseAgentWritePolicy(
        policy({
          requiredPaths: ["src/content/new.mdx"],
        }),
      )!,
    });
    expect(
      await denied.dispatch("add_page", { pageId: "new", title: "New" }),
    ).toContain("outside the controller-approved");

    const allowed = buildToolBridge(directory, {
      writePolicy: parseAgentWritePolicy(
        policy({
          requiredPaths: ["docs.json", "src/content/new.mdx"],
          maximumFiles: 2,
        }),
      )!,
    });
    expect(
      await allowed.dispatch("add_page", { pageId: "new", title: "New" }),
    ).toContain("Page created");
  });

  it("requires an explicit planned OpenAPI source", async () => {
    const directory = repository();
    writeFileSync(
      join(directory, "openapi.json"),
      '{"openapi":"3.1.0","paths":{}}\n',
    );
    const bridge = buildToolBridge(directory, {
      writePolicy: parseAgentWritePolicy(
        policy({ requiredPaths: ["openapi.json"] }),
      )!,
    });
    expect(
      await bridge.dispatch("update_api_spec", {
        content: '{"openapi":"3.1.0","paths":{}}',
      }),
    ).toContain("outside the controller-approved");
  });

  it("rejects a planned page whose repository path resolves through a symlink", async () => {
    const directory = repository();
    const outside = join(tmpdir(), `thally-agent-outside-${Date.now()}.mdx`);
    temporaryDirectories.push(outside);
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(directory, "src", "content", "linked.mdx"));
    const bridge = buildToolBridge(directory, {
      writePolicy: parseAgentWritePolicy(
        policy({ requiredPaths: ["src/content/linked.mdx"] }),
      )!,
    });
    expect(
      await bridge.dispatch("update_page", {
        pageId: "linked",
        content: "Nope",
      }),
    ).toContain("outside the controller-approved");
    expect(readFileSync(outside, "utf8")).toBe("outside");
  });
});

describe("final repository policy gate", () => {
  it("accepts only the exact paths, byte budget, and change IDs", () => {
    const directory = repository();
    writeFileSync(join(directory, "src", "content", "api.mdx"), "Updated\n");
    const parsed = parseAgentWritePolicy(policy())!;
    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "drafted",
        explanation: "Updated the API page.",
        inspectedPaths: ["api"],
        changeIds: ["change-1"],
      }),
    ).not.toThrow();
  });

  it("preserves exact-all v1 semantics for a multi-file initial draft", () => {
    const directory = repository();
    writeFileSync(join(directory, "src", "content", "api.mdx"), "Updated\n");

    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy({ ...revisionPolicy(), version: 1 })!,
        {
          outcome: "drafted",
          explanation: "Updated only one planned page.",
          inspectedPaths: ["api"],
          changeIds: ["change-1", "change-2"],
        },
      ),
    ).toThrow("agent_write_policy_paths_mismatch");
  });

  it("allows a targeted revision to change one non-empty subset of the original plan", () => {
    const directory = repository();
    writeFileSync(join(directory, "src", "content", "guide.mdx"), "Revised\n");

    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy(revisionPolicy())!,
        {
          outcome: "drafted",
          explanation: "Applied the reviewer request to the guide only.",
          inspectedPaths: ["guide"],
          changeIds: ["change-2"],
        },
      ),
    ).not.toThrow();
  });

  it("rejects empty revision results and clean revision abstentions", () => {
    const directory = repository();
    const parsed = parseAgentWritePolicy(revisionPolicy())!;

    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "drafted",
        explanation: "No files changed.",
        inspectedPaths: [],
        changeIds: ["change-1"],
      }),
    ).toThrow("agent_write_policy_paths_mismatch");
    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "abstained",
        reason: "already_documented",
        explanation: "No update needed.",
        inspectedPaths: ["api"],
        changeIds: ["change-1"],
      }),
    ).toThrow("agent_write_policy_revision_noop");
  });

  it("rejects revision paths and change IDs outside the sealed original plan", () => {
    const directory = repository();
    const parsed = parseAgentWritePolicy(revisionPolicy())!;
    writeFileSync(join(directory, "outside.mdx"), "Injected\n");

    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "drafted",
        explanation: "Changed an unplanned file.",
        inspectedPaths: ["outside"],
        changeIds: ["change-1"],
      }),
    ).toThrow("agent_write_policy_paths_mismatch");

    rmSync(join(directory, "outside.mdx"));
    writeFileSync(join(directory, "src", "content", "api.mdx"), "Revised\n");
    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "drafted",
        explanation: "Used an unplanned change identity.",
        inspectedPaths: ["api"],
        changeIds: ["attacker-change"],
      }),
    ).toThrow("agent_write_policy_change_ids_mismatch");
    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "drafted",
        explanation: "Replayed one identity twice.",
        inspectedPaths: ["api"],
        changeIds: ["change-1", "change-1"],
      }),
    ).toThrow("agent_write_policy_change_ids_mismatch");
  });

  it("does not broaden a parsed revision authority when its source is mutated or replayed", () => {
    const directory = repository();
    const source = revisionPolicy();
    const parsed = parseAgentWritePolicy(source)!;
    source.requiredPaths[0] = "outside.mdx";
    source.requiredChangeIds[0] = "attacker-change";
    writeFileSync(join(directory, "outside.mdx"), "Injected\n");

    expect(parsed.requiredPaths).not.toContain("outside.mdx");
    expect(parsed.requiredChangeIds).not.toContain("attacker-change");
    expect(() =>
      assertAgentWritePolicySatisfied(directory, parsed, {
        outcome: "drafted",
        explanation: "Replayed with broadened source arrays.",
        inspectedPaths: ["outside"],
        changeIds: ["attacker-change"],
      }),
    ).toThrow("agent_write_policy_change_ids_mismatch");
  });

  it("fails closed for extra paths, missing IDs, dirty abstention, and byte excess", () => {
    const directory = repository();
    writeFileSync(join(directory, "src", "content", "api.mdx"), "Updated\n");
    writeFileSync(join(directory, "extra.txt"), "extra");
    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy(policy())!,
        {
          outcome: "drafted",
          explanation: "Updated docs.",
          inspectedPaths: ["api"],
          changeIds: ["change-1"],
        },
      ),
    ).toThrow("agent_write_policy_paths_mismatch");

    rmSync(join(directory, "extra.txt"));
    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy(policy())!,
        {
          outcome: "drafted",
          explanation: "Updated docs.",
          inspectedPaths: ["api"],
          changeIds: ["wrong"],
        },
      ),
    ).toThrow("agent_write_policy_change_ids_mismatch");
    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy(policy())!,
        {
          outcome: "abstained",
          reason: "already_documented",
          explanation: "No update needed.",
          inspectedPaths: ["api"],
          changeIds: ["change-1"],
        },
      ),
    ).toThrow("agent_write_policy_abstention_dirty");
    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy(policy({ maximumBytes: 1 }))!,
        {
          outcome: "drafted",
          explanation: "Updated docs.",
          inspectedPaths: ["api"],
          changeIds: ["change-1"],
        },
      ),
    ).toThrow("agent_write_policy_bytes_exceeded");
  });

  it("treats a rename as an unplanned delete plus an add", () => {
    const directory = repository();
    git(directory, ["mv", "src/content/api.mdx", "src/content/renamed.mdx"]);
    expect(() =>
      assertAgentWritePolicySatisfied(
        directory,
        parseAgentWritePolicy(
          policy({ requiredPaths: ["src/content/renamed.mdx"] }),
        )!,
        {
          outcome: "drafted",
          explanation: "Renamed the page.",
          inspectedPaths: ["renamed"],
          changeIds: ["change-1"],
        },
      ),
    ).toThrow("agent_write_policy_paths_mismatch");
  });

  it("normalizes repository-root Git paths for a nested documentation project", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "thally-agent-monorepo-policy-"),
    );
    temporaryDirectories.push(directory);
    const projectDirectory = join(directory, "apps", "documentation");
    mkdirSync(join(projectDirectory, "src", "content"), { recursive: true });
    writeFileSync(join(projectDirectory, "src", "content", "api.mdx"), "Old\n");
    writeFileSync(join(projectDirectory, "docs.json"), '{"pages":["api"]}\n');
    git(directory, ["init"]);
    git(directory, ["config", "user.name", "Thally Test"]);
    git(directory, ["config", "user.email", "test@example.invalid"]);
    git(directory, ["add", "-A"]);
    git(directory, ["commit", "-m", "test: seed nested docs"]);

    writeFileSync(
      join(projectDirectory, "src", "content", "api.mdx"),
      "Updated\n",
    );
    expect(() =>
      assertAgentWritePolicySatisfied(
        projectDirectory,
        parseAgentWritePolicy(policy())!,
        {
          outcome: "drafted",
          explanation: "Updated the nested API page.",
          inspectedPaths: ["api"],
          changeIds: ["change-1"],
        },
      ),
    ).not.toThrow();

    // The public policy remains project-relative even though Git's porcelain
    // path is rooted at the repository. A double-prefixed controller policy is
    // therefore rejected instead of being silently reinterpreted.
    expect(() =>
      assertAgentWritePolicySatisfied(
        projectDirectory,
        parseAgentWritePolicy(
          policy({ requiredPaths: ["apps/documentation/src/content/api.mdx"] }),
        )!,
        {
          outcome: "drafted",
          explanation: "Updated the nested API page.",
          inspectedPaths: ["api"],
          changeIds: ["change-1"],
        },
      ),
    ).toThrow("agent_write_policy_paths_mismatch");
  });
});
