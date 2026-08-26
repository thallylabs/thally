/** Read-page boundaries: scoped paths, UTF-8 validation, and continuation. */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleReadPage } from "../tools/read-page.js";

const workspaces: Array<string> = [];

function project(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "thally-read-page-"));
  workspaces.push(projectDir);
  mkdirSync(join(projectDir, "src", "content"), { recursive: true });
  return projectDir;
}

afterEach(() => {
  for (const directory of workspaces.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("read_page", () => {
  it("returns explicit continuation metadata for a large MDX body", async () => {
    const projectDir = project();
    writeFileSync(
      join(projectDir, "src", "content", "large.mdx"),
      `---\ntitle: Large\n---\n${"é".repeat(100_000)}`,
    );
    const first = await handleReadPage({
      projectDir,
      pageId: "large",
      maxBytes: 180 * 1024,
    });
    expect(first).toContain("complete: false");
    expect(first).toContain("--- MDX body ---");
    const next = Number(first.match(/next-start-byte: (\d+)/)?.[1]);
    await expect(
      handleReadPage({ projectDir, pageId: "large", startByte: next }),
    ).resolves.toContain("complete: true");
  });

  it("rejects traversal, symlinks, and malformed UTF-8", async () => {
    const projectDir = project();
    const outside = join(projectDir, "outside.mdx");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(projectDir, "src", "content", "linked.mdx"));
    writeFileSync(
      join(projectDir, "src", "content", "invalid.mdx"),
      Buffer.from([0x61, 0xc3, 0x28]),
    );

    await expect(
      handleReadPage({ projectDir, pageId: "../../outside" }),
    ).rejects.toThrow("safe content-relative");
    await expect(
      handleReadPage({ projectDir, pageId: "linked" }),
    ).rejects.toThrow("regular file inside");
    await expect(
      handleReadPage({ projectDir, pageId: "invalid" }),
    ).rejects.toThrow("not valid UTF-8");
  });
});
