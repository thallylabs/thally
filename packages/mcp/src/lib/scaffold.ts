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
  EXCLUDE_PATHS,
  STABLE_SCAFFOLD_RELEASE,
  TEMPLATE_REPOSITORY,
  scaffold as scaffoldProject,
  shouldInclude,
  type ScaffoldOptions,
  type ScaffoldResult,
} from 'create-thally-docs/scaffold'
import { buildStarterDocsJson } from 'create-thally-docs/starter'

export const MCP_TEMPLATE_REPOSITORY = TEMPLATE_REPOSITORY
export const MCP_TEMPLATE_COMMIT_SHA = STABLE_SCAFFOLD_RELEASE.source.commitSha
export const MCP_SCAFFOLD_RELEASE_ID = STABLE_SCAFFOLD_RELEASE.id
export const MCP_EXCLUDE_PATHS = EXCLUDE_PATHS
export const shouldIncludeMcpTemplatePath = shouldInclude
export { buildStarterDocsJson }

/** Scaffold an MCP-created site through the canonical package implementation. */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  return scaffoldProject(options)
}
