/** Read one explicitly configured OpenAPI source for documentation work. */

import { z } from "zod";

import { resolveApiSourcePath } from "../lib/api-spec.js";
import {
  createTextWindow,
  MODEL_READ_WINDOW_MAX_BYTES,
  readModelTextFile,
  renderTextWindow,
} from "../lib/text-window.js";

export const readApiSpecSchema = z.object({
  projectDir: z.string().describe("Path to the Thally project root"),
  source: z
    .string()
    .optional()
    .describe("Configured OpenAPI source; omit when the project has one"),
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
    .describe("1-based source line to start at; do not combine with startByte"),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(MODEL_READ_WINDOW_MAX_BYTES)
    .optional()
    .describe(
      `Maximum source bytes to return (default 49152, maximum ${MODEL_READ_WINDOW_MAX_BYTES})`,
    ),
});

export type ReadApiSpecInput = z.infer<typeof readApiSpecSchema>;

export async function handleReadApiSpec(
  input: ReadApiSpecInput,
): Promise<string> {
  const source = resolveApiSourcePath(input.projectDir, input.source);
  const window = createTextWindow(readModelTextFile(source.path), input);
  return [
    `API source: ${source.source}`,
    ...renderTextWindow(window).split("\n"),
  ].join("\n");
}
