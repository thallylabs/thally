/** Apply one exact, bounded text replacement inside an existing MDX page. */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";

const MAX_REPLACEMENT_BYTES = 64 * 1024;

export const replacePageTextSchema = z.object({
  projectDir: z.string().describe("Path to the Thally project root"),
  pageId: z
    .string()
    .describe(
      'Page identifier (for example "guides/auth"). No .mdx extension.',
    ),
  oldText: z
    .string()
    .min(1)
    .max(MAX_REPLACEMENT_BYTES)
    .describe("Exact existing text to replace; it must occur exactly once"),
  newText: z
    .string()
    .min(1)
    .max(MAX_REPLACEMENT_BYTES)
    .describe(
      "Complete replacement prose for oldText; never include a Track evidence marker",
    ),
  evidenceReferenceId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Exact evidence reference ID supplied by Track. When present, the tool appends its deterministic citation marker.",
    ),
});

export type ReplacePageTextInput = z.infer<typeof replacePageTextSchema>;

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    Boolean(fromRoot) &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function pageFile(projectDir: string, pageId: string): string {
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/u.test(pageId) ||
    pageId.split("/").some((part) => part.toLowerCase() === ".git")
  ) {
    throw new Error("Invalid pageId.");
  }
  const contentRoot = realpathSync(join(projectDir, "src", "content"));
  const candidates = [
    join(projectDir, "src", "content", `${pageId}.mdx`),
    join(projectDir, "src", "content", pageId, "index.mdx"),
  ];
  const existing = candidates.filter((candidate) => existsSync(candidate));
  if (existing.length !== 1) throw new Error("Page not found or ambiguous.");
  const candidate = existing[0]!;
  const metadata = lstatSync(candidate);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !isInside(contentRoot, realpathSync(candidate))
  ) {
    throw new Error("Page must be a regular file inside src/content.");
  }
  return candidate;
}

function consumedTrailingLineSeparator(value: string): string {
  return value.match(/(\r?\n)[^\S\r\n]*$/u)?.[1] ?? "";
}

/** Replace exactly one known span without transporting the complete page through the model. */
export async function handleReplacePageText(
  input: ReplacePageTextInput,
): Promise<string> {
  if (
    input.oldText.includes("\0") ||
    input.newText.includes("\0") ||
    input.oldText === input.newText ||
    input.newText.trim().length === 0
  ) {
    throw new Error("Replacement text is invalid.");
  }
  const filePath = pageFile(input.projectDir, input.pageId);
  const source = readFileSync(filePath, "utf8");
  const first = source.indexOf(input.oldText);
  if (
    first < 0 ||
    source.indexOf(input.oldText, first + input.oldText.length) >= 0
  ) {
    throw new Error("oldText must match exactly one span.");
  }
  const marker = input.evidenceReferenceId
    ? `<!-- thally-cite:v1:${createHash("sha256")
        .update(`evidence\0${input.evidenceReferenceId}`, "utf8")
        .digest("hex")} -->`
    : null;
  if (marker && input.newText.includes(marker)) {
    throw new Error("Replacement text must not include its citation marker.");
  }
  // oldText may consume the newline that separated the replaced span from the
  // untouched suffix. Keep that separator after the citation marker; otherwise
  // the suffix becomes part of the HTML comment and disappears when rendered.
  const suffixSeparator = marker
    ? consumedTrailingLineSeparator(input.oldText)
    : "";
  const citedReplacement = marker
    ? `${input.newText.replace(/\s*$/u, "")}\n${marker}`
    : input.newText;
  const replacement = `${citedReplacement}${suffixSeparator}`;
  writeFileSync(
    filePath,
    `${source.slice(0, first)}${replacement}${source.slice(first + input.oldText.length)}`,
    "utf8",
  );
  const startLine = source.slice(0, first).split("\n").length;
  // A restored suffix separator is not part of the evidence span. Report the
  // marker line, rather than the following untouched line, as the end.
  const endLine = startLine + citedReplacement.split("\n").length - 1;
  return [
    `✅ Page text replaced: ${input.pageId}`,
    `Final replacement lines: ${startLine}-${endLine}.`,
    "Use this exact final line range for the corresponding factual claim.",
  ].join("\n");
}
