/** Regression coverage for Cloud Track's pre-resolved context handoff. */

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TRACK_AGENT_RESULT_MAX_BYTES } from "@thallylabs/agent";
import {
  readTrackContextFile,
  resolveAgentProviderClientOptions,
  resolveAgentTaskSource,
  resolveTrackAgentOutputTokens,
  serializeTrackAgentResult,
  TRACK_AGENT_PROVIDER_TIMEOUT_MS,
  TRACK_CONTEXT_MAX_BYTES,
} from "../commands/agent.js";

function policy(changeCount: number) {
  return {
    version: 1 as const,
    requiredPaths: ["src/content/docs/test.mdx"],
    requiredChangeIds: Array.from(
      { length: changeCount },
      (_, index) => `change-${index}`,
    ),
    maximumFiles: 1,
    maximumBytes: 1024,
  };
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("readTrackContextFile", () => {
  it("preserves multiline PR context without shell interpretation", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const path = join(directory, "context.md");
    const context = "# PR\n\n`$(touch should-not-run)`\n${{ github.token }}\n";
    writeFileSync(path, context);
    expect(readTrackContextFile(path)).toBe(context);
  });

  it("preserves a valid payload at the exact UTF-8 byte boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const path = join(directory, "context.md");
    const context = "é".repeat(TRACK_CONTEXT_MAX_BYTES / 2);
    writeFileSync(path, context);
    expect(Buffer.byteLength(context, "utf8")).toBe(TRACK_CONTEXT_MAX_BYTES);
    expect(readTrackContextFile(path)).toBe(context);
  });

  it("rejects an oversized payload instead of truncating sealed context", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const path = join(directory, "context.md");
    writeFileSync(path, Buffer.alloc(TRACK_CONTEXT_MAX_BYTES + 1, 0x61));
    expect(() => readTrackContextFile(path)).toThrowError(
      "track_context_invalid",
    );
  });

  it("rejects invalid UTF-8 at the exact byte boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const path = join(directory, "context.md");
    const context = Buffer.alloc(TRACK_CONTEXT_MAX_BYTES, 0x61);
    context[context.length - 1] = 0xc3;
    writeFileSync(path, context);
    expect(() => readTrackContextFile(path)).toThrowError(
      "track_context_invalid",
    );
  });

  it("rejects symlinks without exposing the resolved path", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const target = join(directory, "context.md");
    const link = join(directory, "context-link.md");
    writeFileSync(target, "{}");
    symlinkSync(target, link);
    expect(() => readTrackContextFile(link)).toThrowError(
      "track_context_invalid",
    );
  });

  it("rejects non-regular files with the same closed error", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const path = join(directory, "context-directory");
    mkdirSync(path);
    expect(() => readTrackContextFile(path)).toThrowError(
      "track_context_invalid",
    );
  });

  it("rejects a missing file without disclosing runner paths", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-track-context-"));
    directories.push(directory);
    const path = join(directory, "missing-context.md");
    expect(() => readTrackContextFile(path)).toThrowError(
      /^track_context_invalid$/,
    );
  });
});

describe("resolveAgentTaskSource", () => {
  it.each([
    [undefined, undefined, "cli"],
    ["https://github.com/acme/product/pull/42", undefined, "track"],
    [undefined, "/tmp/sealed-track-context.json", "track"],
    [
      "https://github.com/acme/product/pull/42",
      "/tmp/sealed-track-context.json",
      "track",
    ],
  ] as const)(
    "classifies fromPr=%s contextFile=%s as %s",
    (fromPr, contextFile, expected) => {
      expect(resolveAgentTaskSource(fromPr, contextFile)).toBe(expected);
    },
  );
});

describe("resolveAgentProviderClientOptions", () => {
  it("gives managed Track one bounded non-streaming provider attempt", () => {
    expect(
      resolveAgentProviderClientOptions("/tmp/sealed-context.json"),
    ).toEqual({
      timeout: TRACK_AGENT_PROVIDER_TIMEOUT_MS,
      maxRetries: 0,
    });
    expect(TRACK_AGENT_PROVIDER_TIMEOUT_MS).toBeLessThan(10 * 60_000);
  });

  it("preserves the public CLI client's defaults without sealed context", () => {
    expect(resolveAgentProviderClientOptions(undefined)).toEqual({});
  });
});

describe("resolveTrackAgentOutputTokens", () => {
  it("uses a small gateway-safe budget for the ordinary focused Track plan", () => {
    expect(resolveTrackAgentOutputTokens(policy(1))).toBe(8_192);
    expect(resolveTrackAgentOutputTokens(policy(32))).toBe(8_192);
  });

  it("retains progressively larger terminal capacity for large sealed plans", () => {
    expect(resolveTrackAgentOutputTokens(policy(33))).toBe(16_384);
    expect(resolveTrackAgentOutputTokens(policy(129))).toBe(32_768);
    expect(resolveTrackAgentOutputTokens(policy(257))).toBe(64_000);
    expect(resolveTrackAgentOutputTokens(policy(500))).toBe(64_000);
  });
});

describe("serializeTrackAgentResult", () => {
  it("preserves a policy-bound factual-claim inventory verbatim", () => {
    const decision = {
      outcome: "drafted",
      explanation: "Updated the authorized guide.",
      inspectedPaths: ["src/content/docs/test.mdx"],
      changeIds: ["change-1"],
      factualClaims: [
        {
          path: "src/content/docs/test.mdx",
          startLine: 8,
          endLine: 9,
          changeIds: ["change-1"],
          evidenceReferenceIds: ["evidence:test"],
        },
      ],
    };

    expect(JSON.parse(serializeTrackAgentResult(decision))).toEqual(decision);
  });

  it("accepts the exact private result-file boundary", () => {
    const framingBytes = Buffer.byteLength(
      JSON.stringify({ value: "" }) + "\n",
      "utf8",
    );
    const decision = {
      value: "x".repeat(TRACK_AGENT_RESULT_MAX_BYTES - framingBytes),
    };
    expect(Buffer.byteLength(serializeTrackAgentResult(decision), "utf8")).toBe(
      TRACK_AGENT_RESULT_MAX_BYTES,
    );
  });

  it("rejects a result one byte beyond the private parser boundary", () => {
    const framingBytes = Buffer.byteLength(
      JSON.stringify({ value: "" }) + "\n",
      "utf8",
    );
    const decision = {
      value: "x".repeat(TRACK_AGENT_RESULT_MAX_BYTES - framingBytes + 1),
    };
    expect(() => serializeTrackAgentResult(decision)).toThrowError(
      "agent_result_too_large",
    );
  });
});
