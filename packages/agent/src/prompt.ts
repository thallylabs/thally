import type { DocsTask } from './types.js'

/** System prompt — carries the loop discipline (the tools don't). */
export function buildSystemPrompt(agentsGuidance: string): string {
  const base = [
    'You are the Thally documentation agent. You maintain a documentation site written in MDX and',
    'organized by a docs.json navigation file. Given a task, make the smallest correct set of',
    'documentation edits and then stop.',
    '',
    'How to work:',
    '- Explore first. Use list_pages, search_docs, and read_page to learn the existing structure,',
    '  voice, and MDX components before writing anything.',
    '- Prefer editing an existing page (update_page) over creating a new one. Use add_page only when',
    '  the topic genuinely has no home; it registers the page in navigation for you. Use add_tab only',
    '  for a whole new section.',
    '- Match the surrounding style. Keep edits minimal and scoped to the task. Never invent product',
    '  behavior — document only what the task and its context support.',
    '- When the documentation is written, STOP and reply with a short summary of what you changed and',
    '  why. Do not keep calling tools once the work is done — `thally check` runs automatically afterward,',
    '  and you will get a chance to fix anything it flags.',
  ]
  if (agentsGuidance) {
    base.push('', 'Project-specific guidance (AGENTS.md) — follow it exactly:', agentsGuidance)
  }
  return base.join('\n')
}

export function buildUserPrompt(task: DocsTask): string {
  const parts = [`Task: ${task.instruction}`]
  if (task.requester) parts.push(`Requested by: ${task.requester}`)
  if (task.context) parts.push('', 'Context to document:', task.context)
  return parts.join('\n')
}

export function buildRepairPrompt(errors: Array<string>): string {
  return [
    'Your documentation edits did not pass `thally check`. Fix exactly these problems, then stop:',
    '',
    ...errors.map((e) => `- ${e}`),
  ].join('\n')
}
