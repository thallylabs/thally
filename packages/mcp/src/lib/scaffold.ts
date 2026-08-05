/**
 * MCP adapter for the canonical Thally project scaffolder.
 *
 * Keeping this module intentionally thin prevents MCP from silently shipping a
 * second template URL, exclusion policy, or starter-content implementation.
 * The published MCP package declares `create-thally-docs` as a runtime
 * dependency, so `npx @thallylabs/mcp` remains self-contained for users while
 * every creation surface consumes the same immutable release.
 */

import {
  STABLE_SCAFFOLD_RELEASE,
  STARTER_REPOSITORY,
  scaffold as scaffoldProject,
  type ScaffoldOptions,
  type ScaffoldResult,
} from 'create-thally-docs/scaffold'

export const MCP_STARTER_REPOSITORY = STARTER_REPOSITORY
export const MCP_STARTER_COMMIT_SHA = STABLE_SCAFFOLD_RELEASE.source.commitSha
export const MCP_SCAFFOLD_RELEASE_ID = STABLE_SCAFFOLD_RELEASE.id

/** Scaffold an MCP-created site through the canonical package implementation. */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  return scaffoldProject(options)
}
