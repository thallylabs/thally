import { describe, it, expect } from 'vitest'
import { runAgentLoop, type AnthropicLike, type CreateResponse, type Message } from '../agent'

function stubClient(responses: Array<CreateResponse>): { client: AnthropicLike; calls: Array<{ messages: Array<Message> }> } {
  const calls: Array<{ messages: Array<Message> }> = []
  let i = 0
  const client: AnthropicLike = {
    messages: {
      create: async (body) => {
        calls.push({ messages: [...body.messages] }) // snapshot — the loop mutates the array
        return responses[i++] ?? { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }
      },
    },
  }
  return { client, calls }
}

const base = { model: 'm', maxSteps: 10, system: 's', userPrompt: 'do it', tools: [] as never[] }

describe('runAgentLoop', () => {
  it('dispatches a tool call, feeds the result back, and stops on a text turn', async () => {
    const { client, calls } = stubClient([
      { content: [{ type: 'tool_use', id: 't1', name: 'read_page', input: { pageId: 'intro' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Updated the intro page.' }], stop_reason: 'end_turn' },
    ])
    const dispatched: Array<string> = []
    const res = await runAgentLoop({ ...base, client, dispatch: async (name) => { dispatched.push(name); return 'page body' } })

    expect(dispatched).toEqual(['read_page'])
    expect(res.summary).toBe('Updated the intro page.')
    expect(res.steps).toBe(2)
    // The second turn must carry the tool_result back to the model.
    const lastMsg = calls[1].messages.at(-1)!
    expect((lastMsg.content as Array<{ type: string; tool_use_id: string; content: string }>)[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'page body',
    })
  })

  it('feeds a tool failure back as an error result and keeps going (the repair mechanism)', async () => {
    const { client, calls } = stubClient([
      { content: [{ type: 'tool_use', id: 't1', name: 'update_page', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Recovered.' }], stop_reason: 'end_turn' },
    ])
    const res = await runAgentLoop({ ...base, client, dispatch: async () => { throw new Error('page not found') } })

    const fedBack = (calls[1].messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>)[0]
    expect(fedBack.is_error).toBe(true)
    expect(fedBack.content).toContain('page not found')
    expect(res.summary).toBe('Recovered.')
  })

  it('stops at maxSteps when the model never stops calling tools', async () => {
    const forever: CreateResponse = {
      content: [{ type: 'tool_use', id: 't', name: 'list_pages', input: {} }],
      stop_reason: 'tool_use',
    }
    const client: AnthropicLike = { messages: { create: async () => forever } }
    const res = await runAgentLoop({ ...base, client, maxSteps: 3, dispatch: async () => 'ok' })
    expect(res.steps).toBe(3)
  })
})
