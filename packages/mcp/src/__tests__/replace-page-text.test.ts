/** Focused contract tests for bounded existing-page replacements. */

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { handleReplacePageText } from "../tools/replace-page-text.js";

function fixture(body = "Before\nUnique sentence.\nAfter\n") {
  const projectDir = mkdtempSync(join(tmpdir(), "thally-replace-page-"));
  const contentDir = join(projectDir, "src", "content", "guides");
  mkdirSync(contentDir, { recursive: true });
  const path = join(contentDir, "test.mdx");
  writeFileSync(path, body);
  return { projectDir, path };
}

describe("replace_page_text", () => {
  it("changes only one exact span", async () => {
    const { projectDir, path } = fixture();
    const result = await handleReplacePageText({
      projectDir,
      pageId: "guides/test",
      oldText: "Unique sentence.",
      newText: "Consequential documentation.",
      evidenceReferenceId: "evidence:1",
    });
    const marker = createHash("sha256")
      .update("evidence\0evidence:1", "utf8")
      .digest("hex");
    expect(readFileSync(path, "utf8")).toBe(
      `Before\nConsequential documentation.\n<!-- thally-cite:v1:${marker} -->\nAfter\n`,
    );
    expect(result).toContain("Final replacement lines: 2-3.");
  });

  it("keeps a consumed trailing newline after the citation marker", async () => {
    const { projectDir, path } = fixture();
    const result = await handleReplacePageText({
      projectDir,
      pageId: "guides/test",
      oldText: "Unique sentence.\n",
      newText: "Consequential documentation.\n",
      evidenceReferenceId: "evidence:1",
    });
    const marker = createHash("sha256")
      .update("evidence\0evidence:1", "utf8")
      .digest("hex");

    expect(readFileSync(path, "utf8")).toBe(
      `Before\nConsequential documentation.\n<!-- thally-cite:v1:${marker} -->\nAfter\n`,
    );
    expect(result).toContain("Final replacement lines: 2-3.");
  });

  it("rejects an ambiguous span without writing", async () => {
    const { projectDir, path } = fixture("Repeat\nRepeat\n");
    await expect(
      handleReplacePageText({
        projectDir,
        pageId: "guides/test",
        oldText: "Repeat",
        newText: "Changed",
      }),
    ).rejects.toThrow("exactly one span");
    expect(readFileSync(path, "utf8")).toBe("Repeat\nRepeat\n");
  });

  it("rejects a symlinked page without writing its target", async () => {
    const { projectDir, path } = fixture();
    const outside = join(projectDir, "outside.mdx");
    writeFileSync(outside, "Outside\n");
    // Replace the fixture page with a link to prove the handler checks file
    // identity before reading or mutating the selected content path.
    unlinkSync(path);
    symlinkSync(outside, path);

    await expect(
      handleReplacePageText({
        projectDir,
        pageId: "guides/test",
        oldText: "Outside",
        newText: "Changed",
      }),
    ).rejects.toThrow("regular file inside src/content");
    expect(readFileSync(outside, "utf8")).toBe("Outside\n");
  });
});
