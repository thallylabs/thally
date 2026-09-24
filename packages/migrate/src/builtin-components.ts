/**
 * Thally's registered MDX built-in component tag names, kept in one place so
 * the unknown-component fallback (`mdx.ts`) knows what already renders
 * without guessing. Mirrors the registry in the Thally runtime's
 * `src/components/mdx/mdx-components.tsx` (read-only from this package,
 * which ships standalone and cannot import app source at runtime).
 *
 * A drift guard (`src/components/mdx/client-registry.test.ts`, in the app
 * package) recomputes this set straight from that registry's AST and fails
 * CI if the two disagree, so a renderer change that adds or removes a
 * built-in fails loudly here instead of silently going stale in the
 * migrator.
 */
export const THALLY_BUILTIN_COMPONENTS: ReadonlySet<string> = new Set([
  'CodeGroup', 'Info', 'Warning', 'Check', 'Danger', 'Error', 'Note', 'Tip',
  'Callout', 'AccordionGroup', 'Latex', 'Hero', 'Card', 'CardGroup',
  'Columns', 'Frame', 'Accordion', 'Tooltip', 'Icon', 'Steps', 'Step',
  'Tabs', 'Tab', 'Badge', 'Update', 'RequestExample', 'ResponseExample',
  'Panel', 'ContentPanel', 'InlinePanel', 'InlineRequestExample',
  'InlineResponseExample', 'Tile', 'TileGroup', 'Prompt', 'PromptUser',
  'PromptAssistant', 'Terminal', 'TerminalInput', 'TerminalOutput',
  'AgentPrompt', 'Color', 'Tree', 'Folder', 'File', 'ResponseField',
  'ParamField', 'Expandable', 'Mermaid', 'View', 'Embed', 'LegacyView',
  'GitHub', 'Github', 'Visibility', 'Human', 'Agent', 'BannerPreview',
])

/** True for a builtin tag, or a member-expression tag on one (`Color.Item` -> `Color`). */
export function isThallyBuiltinComponent(name: string): boolean {
  return THALLY_BUILTIN_COMPONENTS.has(name) || THALLY_BUILTIN_COMPONENTS.has(name.split('.')[0])
}
