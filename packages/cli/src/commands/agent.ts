import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { TextDecoder } from "node:util";
import type { ParsedArgs } from "../router.js";
import Anthropic from "@anthropic-ai/sdk";
import {
  runAgent,
  resolveDiff,
  resolvePrContext,
  readAgentWritePolicyFile,
  scaffoldAgentWorkflow,
  originRemoteUrl,
  TrackOwnedChangeError,
  TRACK_AGENT_CONTEXT_MAX_BYTES,
  TRACK_AGENT_MAX_OUTPUT_TOKENS,
  TRACK_AGENT_REQUEST_MAX_BYTES,
  TRACK_AGENT_RESULT_MAX_BYTES,
  type AnthropicLike,
  type DocsTask,
  type OutputMode,
  type TaskSource,
} from "@thallylabs/agent";
import {
  envGitHosts,
  parseRepositoryReference,
  resolveGitHosts,
  type GitProvider,
} from "@thallylabs/mcp/track";

export const TRACK_CONTEXT_MAX_BYTES = TRACK_AGENT_CONTEXT_MAX_BYTES;
const TRACK_CONTEXT_INVALID = "track_context_invalid";
export const TRACK_AGENT_PROVIDER_TIMEOUT_MS = 300_000;

/**
 * Keep ordinary Track turns small enough for the synchronous managed gateway,
 * while retaining the full terminal budget for genuinely large sealed plans.
 * The buckets are intentionally derived only from controller-issued change
 * authority; repository or model text cannot inflate them.
 */
export function resolveTrackAgentOutputTokens(
  writePolicy: ReturnType<typeof readAgentWritePolicyFile> | undefined,
): number {
  const changeCount = writePolicy?.requiredChangeIds.length ?? 0;
  if (changeCount <= 32) return 8_192;
  if (changeCount <= 128) return 16_384;
  if (changeCount <= 256) return 32_768;
  return TRACK_AGENT_MAX_OUTPUT_TOKENS;
}

/**
 * Managed Track already owns retries and a six-minute writer deadline.
 * Supplying the narrower provider budget also prevents the Anthropic SDK from
 * rejecting Track's bounded 64k output ceiling before it contacts the gateway.
 */
export function resolveAgentProviderClientOptions(
  contextFile: string | undefined,
): { timeout?: number; maxRetries?: number } {
  return contextFile
    ? { timeout: TRACK_AGENT_PROVIDER_TIMEOUT_MS, maxRetries: 0 }
    : {};
}

/** Classify every provider-resolved context handoff as automated Track work. */
export function resolveAgentTaskSource(
  fromPr: string | undefined,
  contextFile: string | undefined,
): TaskSource {
  return fromPr || contextFile ? "track" : "cli";
}

function throwInvalidTrackContext(): never {
  // The path can contain credentials or runner internals. Keep this error
  // stable and closed while the caller converts it into a CLI failure.
  throw new Error(TRACK_CONTEXT_INVALID);
}

function closeTrackContextDescriptor(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    throwInvalidTrackContext();
  }
}

/**
 * Read the complete, byte-bounded context payload prepared by Track.
 *
 * The context contains sealed execution authority, so truncation is never
 * safe. Descriptor identity and metadata are checked around the bounded read
 * to reject symlink swaps and observable concurrent mutation.
 */
export function readTrackContextFile(path: string): string {
  let pathStats: ReturnType<typeof lstatSync>;
  try {
    pathStats = lstatSync(path, { bigint: true });
  } catch {
    return throwInvalidTrackContext();
  }

  if (pathStats.isSymbolicLink() || !pathStats.isFile())
    return throwInvalidTrackContext();

  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch {
    return throwInvalidTrackContext();
  }

  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.dev !== pathStats.dev ||
      before.ino !== pathStats.ino ||
      before.size > BigInt(TRACK_CONTEXT_MAX_BYTES)
    ) {
      return throwInvalidTrackContext();
    }

    // One additional byte distinguishes an exact-boundary payload from an
    // oversized stream without ever allocating or reading an unbounded file.
    const bytes = Buffer.allocUnsafe(TRACK_CONTEXT_MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        null,
      );
      if (count === 0) break;
      bytesRead += count;
    }

    if (bytesRead > TRACK_CONTEXT_MAX_BYTES) return throwInvalidTrackContext();

    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      BigInt(bytesRead) !== after.size
    ) {
      return throwInvalidTrackContext();
    }

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytesRead),
      );
    } catch {
      return throwInvalidTrackContext();
    }
  } catch (error) {
    if (error instanceof Error && error.message === TRACK_CONTEXT_INVALID)
      throw error;
    return throwInvalidTrackContext();
  } finally {
    closeTrackContextDescriptor(descriptor);
  }
}

/** Serialize a bounded result artifact for the private writer controller. */
export function serializeTrackAgentResult(decision: unknown): string {
  const serialized = `${JSON.stringify(decision)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > TRACK_AGENT_RESULT_MAX_BYTES) {
    throw new Error("agent_result_too_large");
  }
  return serialized;
}

/** Read `--provider`, rejecting anything other than github or gitlab. */
export function parseProviderFlag(value: string | undefined): GitProvider | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === "github" || normalized === "gitlab" ? normalized : null;
}

/**
 * Provider of the current repository: an explicit flag, else the `origin`
 * remote (known hosts, `THALLY_GIT_HOSTS`, and the GitLab CI server), else GitHub.
 */
export function detectRepositoryProvider(cwd: string, explicit?: GitProvider): GitProvider {
  if (explicit) return explicit;
  const remote = originRemoteUrl(cwd);
  if (!remote) return "github";
  return parseRepositoryReference(remote, { hosts: resolveGitHosts(envGitHosts()) })?.provider ?? "github";
}

function printIndented(text: string): void {
  process.stdout.write(
    text
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
}

/** `thally agent init` — scaffold the docs-repo pipeline + print the product-repo sender. */
function runAgentInit(args: ParsedArgs): number {
  const explicit = parseProviderFlag(args.getFlag("--provider"));
  if (explicit === null) {
    process.stderr.write("\n  ❌ --provider must be github or gitlab.\n\n");
    return 1;
  }
  const provider = detectRepositoryProvider(process.cwd(), explicit);
  const docsRepo =
    args.getFlag("--repo") ?? (provider === "gitlab" ? "<group>/<docs-project>" : "<owner>/<docs-repo>");
  const { written, senderSnippet, notes } = scaffoldAgentWorkflow(process.cwd(), docsRepo, { provider });
  for (const file of written) process.stdout.write(`\n  ✓ Wrote ${file}`);
  process.stdout.write("\n");
  for (const note of notes) {
    process.stdout.write("\n");
    printIndented(note);
    process.stdout.write("\n");
  }

  if (provider === "gitlab") {
    process.stdout.write("\n  In THIS docs project → Settings → CI/CD → Variables (masked):\n");
    process.stdout.write("    - ANTHROPIC_API_KEY    (runs the agent)\n");
    process.stdout.write(
      "    - THALLY_AGENT_TOKEN   (project access token: api + write_repository here, read_api on product projects)\n",
    );
    process.stdout.write(
      "\n  Then create a pipeline trigger token (Settings → CI/CD → Pipeline trigger tokens)\n  and store it as THALLY_DISPATCH_TOKEN in each product project.\n",
    );
    process.stdout.write(
      "\n  Optional: a weekly pipeline schedule with variable THALLY_DRIFT_SWEEP=true runs the drift sweep.\n",
    );
    process.stdout.write(
      "\n  Product projects send merged and docs-preview merge requests with jobs like these\n  (\"thally track setup\" prints them for each tracked project):\n\n",
    );
    printIndented(senderSnippet);
    process.stdout.write(
      "\n  @thally comment mentions need the Thally Cloud webhook on GitLab (Comments events);\n  locally, run: thally agent \"<instruction>\" --from-pr <merge-request-url>\n\n",
    );
    return 0;
  }

  process.stdout.write("\n  Add two secrets to THIS docs repo:\n");
  process.stdout.write("    - ANTHROPIC_API_KEY   (runs the agent)\n");
  process.stdout.write(
    "    - THALLY_AGENT_TOKEN     (fine-grained PAT/App: write here, read on product repos)\n",
  );
  process.stdout.write(
    "\n  Then in each PRODUCT repo, add .github/workflows/thally-mention.yml:\n\n",
  );
  printIndented(senderSnippet);
  process.stdout.write(
    "\n  …and a THALLY_DISPATCH_TOKEN secret there (dispatch access to this docs repo).\n\n",
  );
  return 0;
}

/**
 * `thally agent "<instruction>" [--diff <ref>] [--from-pr <url>] [--context-file <path>] [--write-policy-file <path>] [--dry-run] [--pr]`
 *
 * Turns a task into documentation edits on a git sandbox branch. Default leaves
 * the edits on the branch for review; --dry-run previews and discards; --pr opens
 * a pull request (GitHub) or merge request (GitLab). --from-pr reads a product
 * change's title/body/diff: GitHub PRs via the gh CLI, GitLab merge requests
 * and merge commits via the GitLab API (the path Thally Track dispatches).
 */
export async function runAgentCommand(args: ParsedArgs): Promise<number> {
  if (args.positionals[0] === "init") return runAgentInit(args);

  const instruction = args.positionals.join(" ").trim();
  const fromPr = args.getFlag("--from-pr");
  const diffRef = args.getFlag("--diff");
  const contextFile = args.getFlag("--context-file");
  const requester = args.getFlag("--requester")?.trim();
  const resultFile = args.getFlag("--result-file")?.trim();
  const writePolicyFile = args.getFlag("--write-policy-file")?.trim();
  const provider = parseProviderFlag(args.getFlag("--provider"));
  if (provider === null) {
    process.stderr.write("\n  ❌ --provider must be github or gitlab.\n\n");
    return 1;
  }

  if (!instruction && !fromPr && !contextFile) {
    process.stderr.write(
      '\n  Usage: thally agent "<what to document>" [--diff <ref>] [--from-pr <url>] [--context-file <path>] [--write-policy-file <path>] [--dry-run] [--pr]\n\n',
    );
    return 1;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    process.stderr.write(
      "\n  Set ANTHROPIC_API_KEY to run the docs agent.\n\n",
    );
    return 1;
  }

  let context = "";
  let writePolicy: ReturnType<typeof readAgentWritePolicyFile> | undefined;
  try {
    // Cloud Track resolves private product-repository context with its GitHub
    // App before dispatch. Prefer that bounded context file so the docs-repo
    // Action never needs a cross-repository PAT merely to read the source PR.
    if (contextFile) context = readTrackContextFile(contextFile);
    else if (fromPr) context = await resolvePrContext(fromPr);
    else if (diffRef) context = resolveDiff(process.cwd(), diffRef);
    if (writePolicyFile)
      writePolicy = readAgentWritePolicyFile(writePolicyFile);
  } catch (err) {
    if (err instanceof TrackOwnedChangeError) {
      // GitLab merge-commit dispatches apply the Track loop guard here.
      process.stdout.write(`\n  ${err.message}\n\n`);
      return 0;
    }
    process.stderr.write(
      `\n  ${err instanceof Error ? err.message : String(err)}\n\n`,
    );
    return 1;
  }

  const mode: OutputMode = args.hasFlag("--dry-run")
    ? "dry-run"
    : args.hasFlag("--pr")
      ? "pr"
      : "write";
  const task: DocsTask = {
    instruction: instruction || `Document the changes in ${fromPr}`,
    context: context || undefined,
    requester: requester || undefined,
    source: resolveAgentTaskSource(fromPr, contextFile),
  };

  const real = new Anthropic({
    apiKey,
    ...resolveAgentProviderClientOptions(contextFile),
  });
  const client: AnthropicLike = {
    messages: {
      create: (body) => real.messages.create(body as never) as never,
    },
  };

  process.stdout.write(`\n  🤖 Thally docs agent — ${mode}\n\n`);
  try {
    const result = await runAgent(client, task, {
      projectDir: process.cwd(),
      mode,
      requireChanges: args.hasFlag("--require-changes"),
      writePolicy,
      provider,
      maximumRequestBytes: contextFile
        ? TRACK_AGENT_REQUEST_MAX_BYTES
        : undefined,
      maximumOutputTokens: contextFile
        ? resolveTrackAgentOutputTokens(writePolicy)
        : undefined,
      onEvent: (event) => process.stdout.write(`  ${event}\n`),
    });
    if (resultFile) {
      const temporaryResultFile = `${resultFile}.${process.pid}.tmp`;
      writeFileSync(
        temporaryResultFile,
        serializeTrackAgentResult(result.decision),
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      renameSync(temporaryResultFile, resultFile);
    }

    const v = result.validation;
    if (result.noChanges && !v.ok) {
      process.stderr.write(`\n  Validation failed: ${v.errors.join("; ")}\n\n`);
      return 1;
    }
    if (result.noChanges) {
      process.stdout.write("\n  No documentation changes were needed.\n\n");
      return 0;
    }

    process.stdout.write(`\n  ${result.summary}\n`);
    process.stdout.write(
      `\n  Validation: ${v.ok ? "✓ passed" : `✗ ${v.errors.length} error(s)`}${v.warnings.length ? ` · ${v.warnings.length} warning(s)` : ""}\n`,
    );

    if (mode === "dry-run") {
      process.stdout.write(
        `\n${result.diff}\n  (dry run — nothing was written)\n\n`,
      );
    } else if (mode === "pr" && result.prUrl) {
      process.stdout.write(`\n  Pull request: ${result.prUrl}\n\n`);
    } else {
      process.stdout.write(
        `\n  Edits are on branch "${result.branch}" — review, then commit or open a PR.\n\n`,
      );
    }
    return v.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(
      `\n  Agent failed: ${err instanceof Error ? err.message : String(err)}\n\n`,
    );
    return 1;
  }
}
