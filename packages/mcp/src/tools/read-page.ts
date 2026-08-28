import { z } from "zod";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import { parseFrontmatter } from "../lib/frontmatter.js";
import { readPageBodyDelimiter } from "../lib/page-echo.js";
import {
  createTextWindow,
  MODEL_READ_WINDOW_MAX_BYTES,
  readModelTextFile,
  textWindowMetadata,
} from "../lib/text-window.js";

export const readPageSchema = z.object({
  projectDir: z.string().describe("Path to the Thally project root"),
  pageId: z.string().describe('Page ID, e.g. "guides/authentication"'),
  startByte: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("UTF-8 byte continuation from a previous partial result"),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based body line to start at; do not combine with startByte"),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(MODEL_READ_WINDOW_MAX_BYTES)
    .optional()
    .describe(
      `Maximum body bytes to return (default 49152, maximum ${MODEL_READ_WINDOW_MAX_BYTES})`,
    ),
});

export type ReadPageInput = z.infer<typeof readPageSchema>;

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    Boolean(fromRoot) &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

export async function handleReadPage(input: ReadPageInput): Promise<string> {
  const { projectDir, pageId } = input;
  const contentDir = join(projectDir, "src", "content");
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/u.test(pageId) ||
    pageId.split("/").some((part) => part.toLowerCase() === ".git")
  ) {
    throw new Error("Page ID must be a safe content-relative identifier");
  }
  const contentRoot = realpathSync(contentDir);

  const candidates = [
    join(contentDir, `${pageId}.mdx`),
    join(contentDir, `${pageId}/index.mdx`),
  ];

  let filePath: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      const metadata = lstatSync(c);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        !isInside(contentRoot, realpathSync(c))
      ) {
        throw new Error("Page must be a regular file inside src/content");
      }
      filePath = c;
      break;
    }
  }

  if (!filePath) {
    throw new Error(
      `Page not found: "${pageId}". No file at src/content/${pageId}.mdx`,
    );
  }

  const rawBytes = readModelTextFile(filePath);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error("Page is not valid UTF-8");
  }
  const { data, content } = parseFrontmatter(raw);
  const title = (data.title as string | undefined) ?? pageId;
  const description = (data.description as string | undefined) ?? "";

  // Present metadata as labelled fields, not markdown, and fence the body
  // behind an explicit delimiter. Models mirror what they read: the old
  // H1/blockquote preamble kept getting echoed back through update_page and
  // persisted into src/content on every agent edit.
  const lines = [`id: ${pageId}`, `title: ${title}`];
  if (description) lines.push(`description: ${description}`);
  const window = createTextWindow(Buffer.from(content, "utf8"), input);
  lines.push(
    "",
    ...textWindowMetadata(window),
    "",
    readPageBodyDelimiter(),
    "",
    window.content,
  );

  return lines.join("\n");
}
