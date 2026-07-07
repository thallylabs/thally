import { z } from 'zod'
import { createProjectSchema, handleCreateProject } from '../tools/create-project.js'
import { addPageSchema, handleAddPage } from '../tools/add-page.js'
import { addTabSchema, handleAddTab } from '../tools/add-tab.js'
import { listPagesSchema, handleListPages } from '../tools/list-pages.js'
import { updatePageSchema, handleUpdatePage } from '../tools/update-page.js'
import { migrateDocsSchema, handleMigrateDocs } from '../tools/migrate-docs.js'
import { searchDocsSchema, handleSearchDocs } from '../tools/search-docs.js'
import { semanticSearchSchema, handleSemanticSearch } from '../tools/semantic-search.js'
import { agentReadinessSchema, handleAgentReadiness } from '../tools/agent-readiness.js'
import { readPageSchema, handleReadPage } from '../tools/read-page.js'
import { getContextSchema, handleGetContext } from '../tools/get-context.js'
import { lintProjectSchema, handleLintProject } from '../tools/lint-project.js'
import { translateDocsSchema, handleTranslateDocs } from '../tools/translate-docs.js'

/**
 * Where a tool operates:
 * - `project` — reads/writes a local Dox project directory (`projectDir`).
 * - `site` — queries a deployed Dox site over HTTP (`siteUrl`).
 *
 * The remote MCP endpoint (A6) exposes only what's safe over HTTP; the docs
 * agent (A1) drives the `project` tools against a checked-out docs repo. Both
 * consume this one registry instead of re-declaring the tools.
 */
export type ToolScope = 'project' | 'site'

export interface ToolDefinition {
  name: string
  description: string
  scope: ToolScope
  schema: z.ZodObject<z.ZodRawShape>
  handler: (input: unknown) => Promise<string>
}

/** Type-checks each tool's handler against its schema, then erases to ToolDefinition. */
function defineTool<S extends z.ZodRawShape>(def: {
  name: string
  description: string
  scope: ToolScope
  schema: z.ZodObject<S>
  handler: (input: z.infer<z.ZodObject<S>>) => Promise<string>
}): ToolDefinition {
  return def as unknown as ToolDefinition
}

/** The single source of truth for Dox's MCP/agent tools. */
export const tools: Array<ToolDefinition> = [
  defineTool({
    name: 'create_project',
    description: 'Scaffold a new Dox documentation project from the GitHub template',
    scope: 'project',
    schema: createProjectSchema,
    handler: handleCreateProject,
  }),
  defineTool({
    name: 'add_page',
    description: 'Add a new MDX page to a Dox project and register it in docs.json navigation',
    scope: 'project',
    schema: addPageSchema,
    handler: handleAddPage,
  }),
  defineTool({
    name: 'add_tab',
    description: 'Add a new top-level tab to a Dox project navigation (content tab or redirect link)',
    scope: 'project',
    schema: addTabSchema,
    handler: handleAddTab,
  }),
  defineTool({
    name: 'list_pages',
    description: 'List all pages in a Dox project, organized by tab and group',
    scope: 'project',
    schema: listPagesSchema,
    handler: handleListPages,
  }),
  defineTool({
    name: 'update_page',
    description: 'Update the frontmatter or body content of an existing MDX page in a Dox project',
    scope: 'project',
    schema: updatePageSchema,
    handler: handleUpdatePage,
  }),
  defineTool({
    name: 'migrate_docs',
    description: 'Crawl a docs site and migrate it into a Dox project',
    scope: 'project',
    schema: migrateDocsSchema,
    handler: handleMigrateDocs,
  }),
  defineTool({
    name: 'search_docs',
    description: 'Search documentation pages by keyword — returns ranked list of matching pages',
    scope: 'project',
    schema: searchDocsSchema,
    handler: handleSearchDocs,
  }),
  defineTool({
    name: 'semantic_search',
    description:
      'Hybrid (full-text + vector) semantic search against a deployed Dox site — uses the same index as the in-app command palette and /api/search',
    scope: 'site',
    schema: semanticSearchSchema,
    handler: handleSemanticSearch,
  }),
  defineTool({
    name: 'agent_readiness',
    description:
      'Fetch the Agent Readiness Score (0-100) for a deployed Dox site — the same report as /api/agent-readiness and `dox check`, with per-signal subscores and fixable offenders',
    scope: 'site',
    schema: agentReadinessSchema,
    handler: handleAgentReadiness,
  }),
  defineTool({
    name: 'read_page',
    description: 'Read the full content of a documentation page by its page ID',
    scope: 'project',
    schema: readPageSchema,
    handler: handleReadPage,
  }),
  defineTool({
    name: 'get_context',
    description: 'Get the most relevant documentation context for a topic or question, within a token budget',
    scope: 'project',
    schema: getContextSchema,
    handler: handleGetContext,
  }),
  defineTool({
    name: 'lint_project',
    description: 'Check a Dox project for issues: broken nav references, orphan files, missing frontmatter',
    scope: 'project',
    schema: lintProjectSchema,
    handler: handleLintProject,
  }),
  defineTool({
    name: 'translate_docs',
    description: 'Translate Dox documentation pages to a secondary locale using Claude AI',
    scope: 'project',
    schema: translateDocsSchema,
    handler: handleTranslateDocs,
  }),
]

/** Look up a tool by its registered name. */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name)
}
