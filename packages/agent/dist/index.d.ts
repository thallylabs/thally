interface ClaudeTool {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}
interface ToolBridge {
    claudeTools: Array<ClaudeTool>;
    dispatch: (name: string, input: Record<string, unknown>) => Promise<string>;
}
/**
 * Bridge the shared MCP registry to Claude tool-use: convert each tool's zod
 * schema to inlined JSON Schema (no $ref — Anthropic wants a plain object),
 * hide `projectDir` from the model, and inject it at call time.
 */
declare function buildToolBridge(projectDir: string): ToolBridge;

type ContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
};
interface ToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}
type Message = {
    role: 'user' | 'assistant';
    content: string | Array<ContentBlock | ToolResultBlock>;
};
interface CreateResponse {
    content: Array<ContentBlock>;
    stop_reason: string | null;
}
/** The slice of the Anthropic client the loop needs — injectable for tests. */
interface AnthropicLike {
    messages: {
        create(body: {
            model: string;
            max_tokens: number;
            system?: string;
            tools?: Array<ClaudeTool>;
            messages: Array<Message>;
        }): Promise<CreateResponse>;
    };
}
interface LoopInput {
    client: AnthropicLike;
    model: string;
    maxSteps: number;
    system: string;
    userPrompt: string;
    tools: Array<ClaudeTool>;
    dispatch: (name: string, input: Record<string, unknown>) => Promise<string>;
    onEvent?: (event: string) => void;
}
/** Run a Claude tool-use loop until the model stops calling tools (or hits the step cap). */
declare function runAgentLoop(input: LoopInput): Promise<{
    summary: string;
    steps: number;
}>;

/** Where a docs task came from. */
type TaskSource = 'cli' | 'mention' | 'merge' | 'drift';
/**
 * The unit of work for the agent. Every trigger surface (the CLI, a `@dox`
 * comment, a merge dispatch, a drift sweep) produces one of these; the agent
 * consumes it the same way regardless of origin.
 */
interface DocsTask {
    /** What to do, in prose. */
    instruction: string;
    /** Resolved context the agent should read before drafting (PR body, diff, issues). */
    context?: string;
    /** Who asked, for attribution in the PR. */
    requester?: string;
    source: TaskSource;
}
type OutputMode = 'dry-run' | 'write' | 'pr';
interface AgentOptions {
    /** The docs project directory (must be a clean git repo). */
    projectDir: string;
    mode: OutputMode;
    model?: string;
    maxSteps?: number;
    /** Progress callback (tool calls, phases). */
    onEvent?: (event: string) => void;
}
interface AgentResult {
    /** The branch the agent worked on. */
    branch: string;
    /** The agent's prose summary of what it changed. */
    summary: string;
    steps: number;
    /** Unified diff of the changes (populated for dry-run and before a PR). */
    diff: string;
    /** Validation outcome after edits (and any repair round). */
    validation: {
        ok: boolean;
        errors: Array<string>;
        warnings: Array<string>;
    };
    /** PR URL, when mode === 'pr'. */
    prUrl?: string;
    /** True when nothing was changed. */
    noChanges: boolean;
}

/**
 * Run a docs task end-to-end on a **git sandbox branch**: assert a clean repo,
 * branch off HEAD, let the agent mutate the tree, self-validate (one repair
 * round), then honor the output mode — dry-run discards, write leaves the branch
 * dirty for review, pr commits + opens a PR.
 */
declare function runAgent(client: AnthropicLike, task: DocsTask, options: AgentOptions): Promise<AgentResult>;

/** Resolve a git ref (e.g. `HEAD~1`, a SHA, `main`) into a unified diff. */
declare function resolveDiff(projectDir: string, ref: string): string;
/** Fetch a GitHub PR's title, body, and diff via the `gh` CLI (needs gh auth). */
declare function resolvePrContext(prUrl: string): string;

/**
 * Load the docs project's AGENTS.md — style rules, never-touch files, review
 * requirements — to steer the agent. Freeform markdown, fed into the system
 * prompt. Empty string when absent.
 */
declare function loadAgentsGuidance(projectDir: string): string;

/**
 * The docs-repo "hub" workflow: it listens for a dispatched docs task (from a
 * `@dox` comment or a merge in a product repo), runs the agent, and opens a
 * documentation PR — plus a scheduled drift sweep. This is the only place the
 * ANTHROPIC_API_KEY lives; product repos never see it.
 */
declare const DOCS_AGENT_WORKFLOW = "name: Dox docs agent\n\non:\n  # A product repo dispatches a docs task here (see the sender workflow).\n  repository_dispatch:\n    types: [dox-document]\n  # Run it by hand from the Actions tab.\n  workflow_dispatch:\n    inputs:\n      instruction:\n        description: What to document\n        required: true\n      from_pr:\n        description: Product PR URL (optional context)\n        required: false\n  # Weekly provenance drift sweep \u2014 flags pages whose sources changed.\n  schedule:\n    - cron: '0 6 * * 1'\n\npermissions:\n  contents: write\n  pull-requests: write\n\njobs:\n  document:\n    if: github.event_name != 'schedule'\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci\n      - name: Configure git\n        run: |\n          git config user.name \"dox-agent\"\n          git config user.email \"dox-agent@users.noreply.github.com\"\n      - name: Draft docs and open a PR\n        env:\n          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n          # A fine-grained PAT / App token with write on this docs repo (and read\n          # on your product repos). Falls back to the built-in token.\n          GH_TOKEN: ${{ secrets.DOX_AGENT_TOKEN || secrets.GITHUB_TOKEN }}\n        run: |\n          INSTRUCTION=\"${{ github.event.client_payload.instruction || inputs.instruction }}\"\n          FROM_PR=\"${{ github.event.client_payload.from_pr || inputs.from_pr }}\"\n          if [ -n \"$FROM_PR\" ]; then\n            npx dox agent \"$INSTRUCTION\" --from-pr \"$FROM_PR\" --pr\n          else\n            npx dox agent \"$INSTRUCTION\" --pr\n          fi\n\n  drift-sweep:\n    if: github.event_name == 'schedule'\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci\n      - name: Check for stale docs\n        run: npx dox check --drift --ci\n";
/** Product-repo sender: a `@dox` comment on a PR dispatches a task to the docs repo. */
declare function mentionSenderWorkflow(docsRepo: string): string;
/**
 * Product-repo sender: on merge to main, dispatch a task iff the diff touches
 * documented surface. Edit the paths filter to match your `watch` globs.
 */
declare function mergeSenderWorkflow(docsRepo: string): string;
interface ScaffoldResult {
    written: Array<string>;
    senderSnippet: string;
}
/** Write the docs-repo agent workflow + a CODEOWNERS roster gate; return the sender snippet. */
declare function scaffoldAgentWorkflow(projectDir: string, docsRepo?: string): ScaffoldResult;

export { type AgentOptions, type AgentResult, type AnthropicLike, type ContentBlock, type CreateResponse, DOCS_AGENT_WORKFLOW, type DocsTask, type LoopInput, type Message, type OutputMode, type TaskSource, buildToolBridge, loadAgentsGuidance, mentionSenderWorkflow, mergeSenderWorkflow, resolveDiff, resolvePrContext, runAgent, runAgentLoop, scaffoldAgentWorkflow };
