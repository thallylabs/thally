/**
 * Deterministic UTF-8 windows for model-facing repository reads.
 *
 * Large documentation pages and API specifications must remain readable
 * without allowing one tool result to consume the managed model gateway's
 * complete request budget. Windows never cut a UTF-8 scalar, and every
 * partial result carries an exact byte continuation plus a whole-file digest.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

export const MODEL_READ_WINDOW_DEFAULT_BYTES = 48 * 1024;
export const MODEL_READ_WINDOW_MAX_BYTES = 180 * 1024;
export const MODEL_READ_SOURCE_MAX_BYTES = 8 * 1024 * 1024;

export interface TextWindowRequest {
  startByte?: number;
  startLine?: number;
  maxBytes?: number;
}

export interface TextWindow {
  content: string;
  contentBytes: number;
  endLine: number;
  isComplete: boolean;
  nextStartByte?: number;
  nextStartLine?: number;
  sha256: string;
  startByte: number;
  startLine: number;
  totalBytes: number;
  totalLines: number;
}

/** Open one regular file without following a final symlink and bound memory use. */
export function readModelTextFile(path: string): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MODEL_READ_SOURCE_MAX_BYTES) {
      throw new Error("text_source_invalid");
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== metadata.size)
      throw new Error("text_source_invalid");
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message === "text_source_invalid")
      throw error;
    throw new Error("text_source_invalid");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Stable model-facing metadata for a window, excluding its content. */
export function textWindowMetadata(window: TextWindow): Array<string> {
  const metadata = [
    `content-sha256: ${window.sha256}`,
    window.contentBytes === 0
      ? `window-bytes: empty at ${window.startByte} of ${window.totalBytes}`
      : `window-bytes: ${window.startByte}-${window.startByte + window.contentBytes - 1} of ${window.totalBytes}`,
    `window-lines: ${window.startLine}-${window.endLine} of ${window.totalLines}`,
    `complete: ${window.isComplete}`,
  ];
  if (!window.isComplete) {
    metadata.push(
      `next-start-byte: ${window.nextStartByte}`,
      `next-start-line: ${window.nextStartLine}`,
    );
  }
  return metadata;
}

function countLinesBefore(bytes: Buffer, end: number): number {
  let lines = 1;
  for (let index = 0; index < end; index += 1) {
    if (bytes[index] === 0x0a) lines += 1;
  }
  return lines;
}

function byteOffsetForLine(bytes: Buffer, requestedLine: number): number {
  if (requestedLine === 1) return 0;
  let line = 1;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    line += 1;
    if (line === requestedLine) return index + 1;
  }
  throw new Error("text_window_start_out_of_range");
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("text_window_invalid_utf8");
  }
}

function isUtf8Boundary(bytes: Buffer, offset: number): boolean {
  return (
    offset === 0 ||
    offset === bytes.byteLength ||
    (bytes[offset]! & 0xc0) !== 0x80
  );
}

/** Return one bounded, lossless view over a validated UTF-8 buffer. */
export function createTextWindow(
  bytes: Buffer,
  request: TextWindowRequest = {},
): TextWindow {
  // Validate the entire file once. Otherwise a later hostile byte sequence
  // could make successive windows disagree about the underlying document.
  decodeUtf8(bytes);

  const maxBytes = request.maxBytes ?? MODEL_READ_WINDOW_DEFAULT_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MODEL_READ_WINDOW_MAX_BYTES
  ) {
    throw new Error("text_window_size_invalid");
  }
  if (request.startByte !== undefined && request.startLine !== undefined) {
    throw new Error("text_window_start_ambiguous");
  }

  let startByte: number;
  if (request.startLine !== undefined) {
    if (!Number.isSafeInteger(request.startLine) || request.startLine < 1) {
      throw new Error("text_window_start_invalid");
    }
    startByte = byteOffsetForLine(bytes, request.startLine);
  } else {
    startByte = request.startByte ?? 0;
    if (
      !Number.isSafeInteger(startByte) ||
      startByte < 0 ||
      startByte > bytes.byteLength ||
      !isUtf8Boundary(bytes, startByte)
    ) {
      throw new Error("text_window_start_invalid");
    }
  }

  let endByte = Math.min(bytes.byteLength, startByte + maxBytes);
  while (endByte > startByte && !isUtf8Boundary(bytes, endByte)) endByte -= 1;
  if (endByte === startByte && startByte < bytes.byteLength) {
    throw new Error("text_window_size_invalid");
  }

  const contentBytes = endByte - startByte;
  const content = decodeUtf8(bytes.subarray(startByte, endByte));
  const startLine = countLinesBefore(bytes, startByte);
  const endLine = startLine + (content.match(/\n/g)?.length ?? 0);
  const isComplete = endByte === bytes.byteLength;
  const totalLines = countLinesBefore(bytes, bytes.byteLength);

  return {
    content,
    contentBytes,
    endLine,
    isComplete,
    ...(isComplete ? {} : { nextStartByte: endByte, nextStartLine: endLine }),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    startByte,
    startLine,
    totalBytes: bytes.byteLength,
    totalLines,
  };
}

/** Render continuation metadata without including any omitted file content. */
export function renderTextWindow(window: TextWindow): string {
  return [...textWindowMetadata(window), "", window.content].join("\n");
}
