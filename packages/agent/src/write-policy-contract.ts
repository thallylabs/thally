/**
 * Runtime-neutral contract for controller-issued documentation write policy.
 *
 * This module deliberately has no Node.js imports or transitive dependencies.
 * Edge controllers can therefore validate untrusted policy payloads without
 * pulling the filesystem and Git enforcement implementation into a Worker.
 */

const MAX_POLICY_PATHS = 500;
const MAX_POLICY_CHANGE_IDS = 500;
const MAX_PATH_BYTES = 512;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const SAFE_CHANGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CHANGE_ID_BYTES = 128;
const JSON_STRING_FRAMING_BYTES = 3;
const POLICY_FIXED_JSON_BYTES = 256;
export const TRACK_AGENT_CONTEXT_MAX_BYTES = 384 * 1_024;

/**
 * Worst-case encoded policy accepted by this contract.
 *
 * Paths forbid controls and backslashes but may contain quotes, so each input
 * byte can require two JSON bytes. Change IDs need no escaping. The fixed
 * allowance covers keys, numeric fields, braces, and array delimiters.
 */
export const MAX_AGENT_WRITE_POLICY_FILE_BYTES =
  POLICY_FIXED_JSON_BYTES +
  MAX_POLICY_PATHS * (MAX_PATH_BYTES * 2 + JSON_STRING_FRAMING_BYTES) +
  MAX_POLICY_CHANGE_IDS * (MAX_CHANGE_ID_BYTES + JSON_STRING_FRAMING_BYTES);

export interface AgentWritePolicyV1 {
  version: 1;
  requiredPaths: Array<string>;
  requiredChangeIds: Array<string>;
  maximumFiles: number;
  maximumBytes: number;
}

/**
 * Same-PR revision authority.
 *
 * Unlike the initial-draft v1 contract, a revision is expected to address a
 * reviewer-selected, non-empty subset of the sealed original plan. The listed
 * paths and change IDs remain an upper bound; they never grant access outside
 * that original authority.
 */
export interface AgentWritePolicyV2 {
  version: 2;
  requiredPaths: Array<string>;
  requiredChangeIds: Array<string>;
  maximumFiles: number;
  maximumBytes: number;
}

export type AgentWritePolicy = AgentWritePolicyV1 | AgentWritePolicyV2;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exact(value: Record<string, unknown>, keys: Array<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function safeRepositoryPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > MAX_PATH_BYTES ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        !part || part === "." || part === ".." || part.toLowerCase() === ".git",
    )
  ) {
    return null;
  }
  return value;
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
  );
}

/** Parse an exact-key, resource-bounded policy without retaining caller-owned objects. */
export function parseAgentWritePolicy(
  value: unknown,
): Readonly<AgentWritePolicy> | null {
  const input = record(value);
  if (
    !input ||
    !exact(input, [
      "version",
      "requiredPaths",
      "requiredChangeIds",
      "maximumFiles",
      "maximumBytes",
    ]) ||
    (input.version !== 1 && input.version !== 2) ||
    !Array.isArray(input.requiredPaths) ||
    !Array.isArray(input.requiredChangeIds) ||
    input.requiredPaths.length < 1 ||
    input.requiredPaths.length > MAX_POLICY_PATHS ||
    input.requiredChangeIds.length < 1 ||
    input.requiredChangeIds.length > MAX_POLICY_CHANGE_IDS ||
    !positiveInteger(input.maximumFiles, MAX_POLICY_PATHS) ||
    !positiveInteger(input.maximumBytes, MAX_TOTAL_BYTES)
  ) {
    return null;
  }
  const requiredPaths = input.requiredPaths.map(safeRepositoryPath);
  if (
    requiredPaths.some((path) => path === null) ||
    new Set(requiredPaths).size !== requiredPaths.length ||
    requiredPaths.length > input.maximumFiles
  ) {
    return null;
  }
  const requiredChangeIds = input.requiredChangeIds;
  if (
    requiredChangeIds.some(
      (id) => typeof id !== "string" || !SAFE_CHANGE_ID.test(id),
    ) ||
    new Set(requiredChangeIds).size !== requiredChangeIds.length
  ) {
    return null;
  }
  return Object.freeze({
    version: input.version,
    requiredPaths: Object.freeze([...(requiredPaths as Array<string>)].sort()),
    requiredChangeIds: Object.freeze(
      [...(requiredChangeIds as Array<string>)].sort(),
    ),
    maximumFiles: input.maximumFiles,
    maximumBytes: input.maximumBytes,
  }) as Readonly<AgentWritePolicy>;
}
