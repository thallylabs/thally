import { z } from 'zod';

/**
 * Where a tool operates:
 * - `project` — reads/writes a local Dox project directory (`projectDir`).
 * - `site` — queries a deployed Dox site over HTTP (`siteUrl`).
 *
 * The remote MCP endpoint (A6) exposes only what's safe over HTTP; the docs
 * agent (A1) drives the `project` tools against a checked-out docs repo. Both
 * consume this one registry instead of re-declaring the tools.
 */
type ToolScope = 'project' | 'site';
interface ToolDefinition {
    name: string;
    description: string;
    scope: ToolScope;
    schema: z.ZodObject<z.ZodRawShape>;
    handler: (input: unknown) => Promise<string>;
}
/** The single source of truth for Dox's MCP/agent tools. */
declare const tools: Array<ToolDefinition>;
/** Look up a tool by its registered name. */
declare function getTool(name: string): ToolDefinition | undefined;

export { type ToolDefinition, type ToolScope, getTool, tools };
