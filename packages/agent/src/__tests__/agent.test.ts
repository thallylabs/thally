import { describe, it, expect } from 'vitest'
import { runAgentLoop, type AnthropicLike, type CreateResponse, type Message } from '../agent'
import {
  assertCleanDocumentationResultIsValid,
  assertDocumentationDecisionMatchesState,
} from '../run'

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
const terminal = (input: Record<string, unknown>, id = 'done'): CreateResponse => ({
  content: [{ type: 'tool_use', id, name: 'submit_documentation_result', input }],
  stop_reason: 'tool_use',
})

describe('runAgentLoop', () => {
  it('dispatches a tool call, feeds the result back, and requires a terminal decision', async () => {
    const { client, calls } = stubClient([
      { content: [{ type: 'tool_use', id: 't1', name: 'read_page', input: { pageId: 'intro' } }], stop_reason: 'tool_use' },
      {
        content: [
          { type: 'text', text: 'Updated the intro page.' },
          {
            type: 'tool_use',
            id: 'done',
            name: 'submit_documentation_result',
            input: { outcome: 'drafted', explanation: 'Updated intro.', inspectedPaths: ['src/content/intro.mdx'], changeIds: ['change-1'] },
          },
        ],
        stop_reason: 'tool_use',
      },
    ])
    const dispatched: Array<string> = []
    const res = await runAgentLoop({ ...base, client, dispatch: async (name) => { dispatched.push(name); return 'page body' } })

    expect(dispatched).toEqual(['read_page'])
    expect(res).toMatchObject({ summary: 'Updated the intro page.', steps: 2, decision: { outcome: 'drafted' } })
    const lastMsg = calls[1].messages.at(-1)!
    expect((lastMsg.content as Array<{ type: string; tool_use_id: string; content: string }>)[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'page body',
    })
  })

  it('feeds a tool failure back as an error result and keeps going', async () => {
    const { client, calls } = stubClient([
      { content: [{ type: 'tool_use', id: 't1', name: 'update_page', input: {} }], stop_reason: 'tool_use' },
      terminal({ outcome: 'abstained', reason: 'insufficient_evidence', explanation: 'No grounded edit.', inspectedPaths: [], changeIds: [] }),
    ])
    const res = await runAgentLoop({ ...base, client, dispatch: async () => { throw new Error('page not found') } })

    const fedBack = (calls[1].messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>)[0]
    expect(fedBack).toMatchObject({ is_error: true })
    expect(fedBack.content).toContain('page not found')
    expect(res.decision).toMatchObject({ outcome: 'abstained', reason: 'insufficient_evidence' })
  })

  it('fails at maxSteps when the model never submits a terminal decision', async () => {
    const forever: CreateResponse = {
      content: [{ type: 'tool_use', id: 't', name: 'list_pages', input: {} }],
      stop_reason: 'tool_use',
    }
    const client: AnthropicLike = { messages: { create: async () => forever } }
    await expect(runAgentLoop({ ...base, client, maxSteps: 3, dispatch: async () => 'ok' })).rejects.toThrow('agent_result_missing')
  })

  it('rejects prose-only completion until the structured terminal tool is called', async () => {
    const { client } = stubClient([
      { content: [{ type: 'text', text: 'Nothing to do.' }], stop_reason: 'end_turn' },
      terminal({ outcome: 'abstained', reason: 'already_documented', explanation: 'The page is current.', inspectedPaths: ['src/content/intro.mdx'], changeIds: ['change-1'] }),
    ])

    const result = await runAgentLoop({ ...base, client, dispatch: async () => 'unused' })

    expect(result.steps).toBe(2)
    expect(result.decision).toMatchObject({ outcome: 'abstained', reason: 'already_documented' })
  })

  it('acknowledges a malformed terminal tool call before requesting repair', async () => {
    const { client, calls } = stubClient([
      terminal({ outcome: 'abstained', reason: 'unknown', explanation: 'No.', inspectedPaths: [], changeIds: [] }, 'bad-result'),
      terminal({ outcome: 'abstained', reason: 'insufficient_evidence', explanation: 'No grounded edit.', inspectedPaths: [], changeIds: [] }, 'good-result'),
    ])

    await runAgentLoop({ ...base, client, dispatch: async () => 'unused' })

    const repair = calls[1].messages.at(-1)!.content as Array<{ type: string; tool_use_id?: string; is_error?: boolean }>
    expect(repair[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'bad-result', is_error: true })
  })
})

describe('post-repair documentation result state', () => {
  const drafted = {
    outcome: 'drafted' as const,
    explanation: 'Updated the guide.',
    inspectedPaths: ['src/content/guide.mdx'],
    changeIds: ['change-1'],
  }
  const abstained = {
    outcome: 'abstained' as const,
    reason: 'already_documented' as const,
    explanation: 'The rejected edit was unnecessary, so the repair removed it.',
    inspectedPaths: ['src/content/guide.mdx'],
    changeIds: ['change-1'],
  }

  it('accepts a repair that removes every edit and explicitly abstains', () => {
    expect(() => assertDocumentationDecisionMatchesState(abstained, false)).not.toThrow()
  })

  it('accepts a dirty repair only when it reports a drafted result', () => {
    expect(() => assertDocumentationDecisionMatchesState(drafted, true)).not.toThrow()
  })

  it('rejects stale post-repair decisions that disagree with git state', () => {
    expect(() => assertDocumentationDecisionMatchesState(drafted, false)).toThrow('agent_result_invalid')
    expect(() => assertDocumentationDecisionMatchesState(abstained, true)).toThrow('agent_result_invalid')
  })

  it('rejects a clean abstention when post-repair validation still failed', () => {
    expect(() =>
      assertCleanDocumentationResultIsValid({
        ok: false,
        errors: ['Navigation remains invalid.'],
        warnings: [],
      }),
    ).toThrow('agent_validation_failed')
    expect(() =>
      assertCleanDocumentationResultIsValid({ ok: true, errors: [], warnings: [] }),
    ).not.toThrow()
  })
})
