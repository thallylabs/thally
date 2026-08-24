import type { ClaudeTool } from './tools.js'
import type { DocumentationDecision } from './types.js'

// Minimal message/content shapes — enough for the loop, and easy to stub in tests.
export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type Message = {
  role: 'user' | 'assistant'
  content: string | Array<ContentBlock | ToolResultBlock>
}

export interface CreateResponse {
  content: Array<ContentBlock>
  stop_reason: string | null
}

/** The slice of the Anthropic client the loop needs — injectable for tests. */
export interface AnthropicLike {
  messages: {
    create(body: { model: string; max_tokens: number; system?: string; tools?: Array<ClaudeTool>; messages: Array<Message> }): Promise<CreateResponse>
  }
}

export interface LoopInput {
  client: AnthropicLike
  model: string
  maxSteps: number
  system: string
  userPrompt: string
  tools: Array<ClaudeTool>
  dispatch: (name: string, input: Record<string, unknown>) => Promise<string>
  onEvent?: (event: string) => void
}

const TERMINAL_TOOL: ClaudeTool = {
  name: 'submit_documentation_result',
  description: 'Finish the task with a structured result. This must be the final and only tool call in the turn.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['outcome', 'explanation', 'inspectedPaths', 'changeIds'],
    properties: {
      outcome: { type: 'string', enum: ['drafted', 'abstained'] },
      reason: {
        type: 'string',
        enum: ['already_documented', 'insufficient_evidence', 'internal_only', 'unsupported_destination'],
      },
      explanation: { type: 'string', minLength: 1, maxLength: 500 },
      inspectedPaths: {
        type: 'array',
        maxItems: 50,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
      changeIds: {
        type: 'array',
        maxItems: 250,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
  },
}

function boundedStrings(value: unknown, maximumItems: number, maximumLength: number): Array<string> | null {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(item)) ||
    new Set(value).size !== value.length
  ) {
    return null
  }
  return value as Array<string>
}

/** Validate the model's terminal decision before it can affect run state. */
export function parseDocumentationDecision(value: Record<string, unknown>): DocumentationDecision | null {
  const allowed = new Set(['outcome', 'reason', 'explanation', 'inspectedPaths', 'changeIds'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  const explanation = value.explanation
  const inspectedPaths = boundedStrings(value.inspectedPaths, 50, 240)
  const changeIds = boundedStrings(value.changeIds, 250, 64)
  if (typeof explanation !== 'string' || explanation.length < 1 || explanation.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(explanation) || !inspectedPaths || !changeIds) {
    return null
  }
  const common = { explanation, inspectedPaths, changeIds }
  if (value.outcome === 'drafted' && value.reason === undefined) {
    return { outcome: 'drafted', ...common }
  }
  if (value.outcome === 'abstained' && ['already_documented', 'insufficient_evidence', 'internal_only', 'unsupported_destination'].includes(String(value.reason))) {
    return {
      outcome: 'abstained',
      reason: value.reason as Extract<DocumentationDecision, { outcome: 'abstained' }>['reason'],
      ...common,
    }
  }
  return null
}

/** Run until the model submits a validated terminal documentation decision. */
export async function runAgentLoop(input: LoopInput): Promise<{
  summary: string
  steps: number
  decision: DocumentationDecision
}> {
  const messages: Array<Message> = [{ role: 'user', content: input.userPrompt }]
  let steps = 0
  let summary = ''

  while (steps < input.maxSteps) {
    steps++
    const res = await input.client.messages.create({
      model: input.model,
      max_tokens: 4096,
      system: input.system,
      tools: [...input.tools, TERMINAL_TOOL],
      messages,
    })
    messages.push({ role: 'assistant', content: res.content })

    const text = res.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (text) summary = text

    const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    const terminalUses = toolUses.filter((use) => use.name === TERMINAL_TOOL.name)
    if (terminalUses.length > 0) {
      const decision = terminalUses.length === 1 && toolUses.length === 1 ? parseDocumentationDecision(terminalUses[0]!.input) : null
      if (decision) return { summary, steps, decision }
      const terminalErrors: Array<ToolResultBlock | ContentBlock> = [
        ...toolUses.map((use): ToolResultBlock => ({
          type: 'tool_result',
          tool_use_id: use.id,
          content: 'Error: submit_documentation_result must be one valid, standalone terminal call.',
          is_error: true,
        })),
        {
          type: 'text',
          text: 'Call submit_documentation_result once, by itself, with a bounded drafted or abstained decision.',
        },
      ]
      messages.push({
        role: 'user',
        content: terminalErrors,
      })
      continue
    }
    if (toolUses.length === 0 || res.stop_reason !== 'tool_use') {
      messages.push({
        role: 'user',
        content: 'Do not stop with prose. Call submit_documentation_result once with the final structured decision.',
      })
      continue
    }

    const results: Array<ToolResultBlock> = []
    for (const use of toolUses) {
      input.onEvent?.(`${use.name} ${JSON.stringify(use.input).slice(0, 100)}`)
      let content: string
      let isError = false
      try {
        content = await input.dispatch(use.name, use.input)
      } catch (err) {
        content = `Error: ${err instanceof Error ? err.message : String(err)}`
        isError = true
      }
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content,
        is_error: isError,
      })
    }
    messages.push({ role: 'user', content: results })
  }

  throw new Error('agent_result_missing')
}
