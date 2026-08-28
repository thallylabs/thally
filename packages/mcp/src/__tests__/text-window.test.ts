/** Regression coverage for lossless, bounded model-facing repository reads. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTextWindow,
  MODEL_READ_SOURCE_MAX_BYTES,
  MODEL_READ_WINDOW_MAX_BYTES,
  readModelTextFile,
  renderTextWindow,
} from "../lib/text-window.js";

describe("text windows", () => {
  it("continues a large single line without splitting a UTF-8 scalar", () => {
    const source = Buffer.from(`prefix-${"é".repeat(120_000)}-suffix`, "utf8");
    const parts: Array<string> = [];
    let startByte = 0;
    let expectedDigest = "";

    do {
      const window = createTextWindow(source, { startByte, maxBytes: 7_001 });
      parts.push(window.content);
      expectedDigest ||= window.sha256;
      expect(window.sha256).toBe(expectedDigest);
      expect(Buffer.byteLength(window.content, "utf8")).toBeLessThanOrEqual(
        7_001,
      );
      if (window.isComplete) break;
      expect(window.nextStartLine).toBe(1);
      startByte = window.nextStartByte!;
    } while (true);

    expect(parts.join("")).toBe(source.toString("utf8"));
  });

  it("supports exact line starts and rejects ambiguous or invalid continuations", () => {
    const source = Buffer.from("one\ntwø\nthree\n", "utf8");
    const second = createTextWindow(source, { startLine: 2, maxBytes: 4 });
    expect(second).toMatchObject({ startLine: 2, content: "twø" });
    expect(() =>
      createTextWindow(source, { startByte: 1, startLine: 1 }),
    ).toThrow("text_window_start_ambiguous");
    expect(() => createTextWindow(source, { startByte: 7 })).toThrow(
      "text_window_start_invalid",
    );
    expect(() => createTextWindow(source, { startLine: 9 })).toThrow(
      "text_window_start_out_of_range",
    );
  });

  it("rejects hostile UTF-8 and out-of-policy window sizes", () => {
    expect(() => createTextWindow(Buffer.from([0x61, 0xc3, 0x28]))).toThrow(
      "text_window_invalid_utf8",
    );
    expect(() =>
      createTextWindow(Buffer.from("safe"), {
        maxBytes: MODEL_READ_WINDOW_MAX_BYTES + 1,
      }),
    ).toThrow("text_window_size_invalid");
  });

  it("fails closed before reading a repository file beyond the source ceiling", () => {
    const directory = mkdtempSync(join(tmpdir(), "thally-text-source-"));
    const path = join(directory, "oversized.mdx");
    try {
      writeFileSync(path, Buffer.alloc(MODEL_READ_SOURCE_MAX_BYTES + 1));
      expect(() => readModelTextFile(path)).toThrow("text_source_invalid");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders explicit continuation metadata instead of silently truncating", () => {
    const rendered = renderTextWindow(
      createTextWindow(Buffer.from("first\nsecond\nthird"), { maxBytes: 8 }),
    );
    expect(rendered).toContain("complete: false");
    expect(rendered).toContain("next-start-byte: 8");
    expect(rendered).toContain("next-start-line: 2");
    expect(rendered).toContain("\n\nfirst\nse");
  });
});
