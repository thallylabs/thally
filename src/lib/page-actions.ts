/** Portable page-action URLs. Installation always targets the site the reader is visiting. */

export interface PageActionsConfig {
  options?: ReadonlyArray<string>
  serverName?: string
}

/** Keep legacy menus unchanged until a site opts into the additional actions. */
export const DEFAULT_PAGE_ACTIONS = ['copy', 'view', 'chatgpt', 'claude', 'perplexity'] as const
export const MCP_PAGE_ACTIONS = ['mcp', 'cursor', 'vscode'] as const
export const PAGE_ACTIONS = [...DEFAULT_PAGE_ACTIONS, 'llms-full', ...MCP_PAGE_ACTIONS] as const

/** The root Markdown mirror keeps its established introduction alias. */
export function pageMarkdownPath(pathname: string): string {
  return pathname === '/' ? '/introduction.md' : `${pathname}.md`
}

/** Build official editor installation links without embedding credentials or another site's host. */
export function mcpPageActions(origin: string, serverName: string) {
  const endpoint = new URL('/api/mcp', origin).href
  const config = btoa(JSON.stringify({ url: endpoint }))
  return {
    command: `npx -y add-mcp ${endpoint}`,
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(serverName)}&config=${encodeURIComponent(config)}`,
    vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: serverName, type: 'http', url: endpoint }))}`,
  }
}
