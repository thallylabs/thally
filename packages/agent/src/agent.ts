import type { ClaudeTool } from './tools.js'

// Minimal message/content shapes — enough for the loop, and easy to stub in tests.
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

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
    create(body: {
      model: string
      max_tokens: number
      system?: string
      tools?: Array<ClaudeTool>
      messages: Array<Message>
    }): Promise<CreateResponse>
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

/** Run a Claude tool-use loop until the model stops calling tools (or hits the step cap). */
export async function runAgentLoop(input: LoopInput): Promise<{ summary: string; steps: number }> {
  const messages: Array<Message> = [{ role: 'user', content: input.userPrompt }]
  let steps = 0
  let summary = ''

  while (steps < input.maxSteps) {
    steps++
    const res = await input.client.messages.create({
      model: input.model,
      max_tokens: 4096,
      system: input.system,
      tools: input.tools,
      messages,
    })
    messages.push({ role: 'assistant', content: res.content })

    const text = res.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (text) summary = text

    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    )
    if (toolUses.length === 0 || res.stop_reason !== 'tool_use') {
      return { summary, steps }
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
      results.push({ type: 'tool_result', tool_use_id: use.id, content, is_error: isError })
    }
    messages.push({ role: 'user', content: results })
  }

  return { summary: summary || 'Reached the step limit before finishing.', steps }
}
