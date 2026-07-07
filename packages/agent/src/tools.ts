import { zodToJsonSchema } from 'zod-to-json-schema'
import { tools as mcpTools, getTool } from '@doxlabs/mcp/tools'

export interface ClaudeTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/**
 * The safe authoring surface the agent exposes to Claude — explore + edit only.
 * Deliberately excludes scaffold/migrate/translate from the MCP registry: those
 * aren't "document a feature into an existing docs repo" operations.
 */
const AGENT_TOOL_NAMES = new Set([
  'list_pages',
  'read_page',
  'search_docs',
  'get_context',
  'add_page',
  'update_page',
  'add_tab',
])

export interface ToolBridge {
  claudeTools: Array<ClaudeTool>
  dispatch: (name: string, input: Record<string, unknown>) => Promise<string>
}

/**
 * Bridge the shared MCP registry to Claude tool-use: convert each tool's zod
 * schema to inlined JSON Schema (no $ref — Anthropic wants a plain object),
 * hide `projectDir` from the model, and inject it at call time.
 */
export function buildToolBridge(projectDir: string): ToolBridge {
  const selected = mcpTools.filter((tool) => AGENT_TOOL_NAMES.has(tool.name))

  const claudeTools: Array<ClaudeTool> = selected.map((tool) => {
    // Cast the erased ZodObject<ZodRawShape> to a plain ZodType: its generic
    // recurses infinitely through zodToJsonSchema otherwise (TS2589).
    const schema = zodToJsonSchema(tool.schema as never, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    }) as Record<string, unknown>
    delete schema.$schema
    const props = schema.properties as Record<string, unknown> | undefined
    if (props) delete props.projectDir
    if (Array.isArray(schema.required)) {
      schema.required = (schema.required as Array<string>).filter((r) => r !== 'projectDir')
    }
    return { name: tool.name, description: tool.description, input_schema: schema }
  })

  const dispatch = async (name: string, input: Record<string, unknown>): Promise<string> => {
    const tool = getTool(name)
    if (!tool || !AGENT_TOOL_NAMES.has(name)) {
      return `Error: tool "${name}" is not available to the docs agent.`
    }
    return tool.handler({ ...input, projectDir })
  }

  return { claudeTools, dispatch }
}
