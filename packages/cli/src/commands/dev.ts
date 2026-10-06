/**
 * `thally dev`: run the local preview and, once the server reports it is
 * ready, print the agent endpoints it serves. The endpoint block is derived
 * from the URL the dev server itself prints, so a fallback port is reported
 * correctly; when that output cannot be parsed, nothing extra is printed.
 */

import { terminal } from 'create-thally-docs/terminal'
import type { ParsedArgs } from '../router.js'
import { projectPackageName, runFramework } from '../process.js'

/** Extract the local URL from a Next.js dev-server banner line. */
export function parseDevServerUrl(line: string): string | undefined {
  const match = /\bLocal:\s+(https?:\/\/[^\s]+)/i.exec(line)
  if (!match) return undefined
  try {
    const url = new URL(match[1])
    return url.origin
  } catch {
    return undefined
  }
}

/** True for the line the dev server prints once it accepts requests. */
export function isDevServerReady(line: string): boolean {
  return /\bReady in\b/i.test(line) || /\bready - started server\b/i.test(line)
}

/**
 * A portable MCP server name for `claude mcp add`: lowercase letters, digits,
 * and hyphens only, so the printed command is always safe to paste.
 */
export function mcpServerName(packageName: string | undefined): string {
  const base = (packageName ?? '').replace(/^@[^/]+\//, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return base || 'docs'
}

/** The endpoint lines printed once the local preview is ready. */
export function agentEndpointLines(baseUrl: string, serverName: string): Array<string> {
  return [
    `Docs index for agents   ${baseUrl}/llms.txt`,
    `MCP server (HTTP)       ${baseUrl}/api/mcp`,
    `Agent Readiness Score   ${baseUrl}/api/agent-readiness`,
    '',
    'Connect Claude Code to this preview:',
    `  claude mcp add --transport http ${serverName} ${baseUrl}/api/mcp`,
  ]
}

/** Run the dev server, forwarding passthrough args after `--`. */
export async function runDev(args: ParsedArgs): Promise<number> {
  let localUrl: string | undefined
  let hasAnnounced = false
  return runFramework('dev', 'dev', args.passthrough, (line) => {
    localUrl ??= parseDevServerUrl(line)
    if (hasAnnounced || !localUrl || !isDevServerReady(line)) return
    hasAnnounced = true
    terminal.section('Agent endpoints', agentEndpointLines(localUrl, mcpServerName(projectPackageName())))
  })
}
