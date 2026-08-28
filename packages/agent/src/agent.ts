import { createHash } from "node:crypto";

import type { ClaudeTool } from "./tools.js";
import type {
  DocumentationDecision,
  DocumentationFactualClaim,
} from "./types.js";
export { TRACK_AGENT_CONTEXT_MAX_BYTES } from "./write-policy-contract.js";

// Minimal message/content shapes — enough for the loop, and easy to stub in tests.
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type Message = {
  role: "user" | "assistant";
  content: string | Array<ContentBlock | ToolResultBlock>;
};

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: Array<ClaudeTool>;
  tool_choice?: {
    type: "tool";
    name: string;
    disable_parallel_tool_use: true;
  };
  messages: Array<Message>;
}

export interface CreateResponse {
  content: Array<ContentBlock>;
  stop_reason: string | null;
}

/** The slice of the Anthropic client the loop needs — injectable for tests. */
export interface AnthropicLike {
  messages: {
    create(body: AnthropicRequest): Promise<CreateResponse>;
  };
}

export interface LoopInput {
  client: AnthropicLike;
  model: string;
  maxSteps: number;
  system: string;
  userPrompt: string;
  tools: Array<ClaudeTool>;
  /** Model-output ceiling for this call profile; defaults to the public CLI budget. */
  maximumOutputTokens?: number;
  /** Exact outer Anthropic JSON-body ceiling for a managed Track gateway. */
  maximumRequestBytes?: number;
  /** Selects the terminal contract enforced for this model session. */
  terminalProfile?: AgentTerminalProfile;
  dispatch: (name: string, input: Record<string, unknown>) => Promise<string>;
  onEvent?: (event: string) => void;
}

export type AgentTerminalProfile = "generic" | "policy-bound";

const TERMINAL_TOOL_NAME = "submit_documentation_result";

/**
 * Build the terminal schema for one execution authority.
 *
 * Anthropic-compatible gateways accept the flat tool-schema subset used here,
 * but not portable conditional constructs such as `oneOf` plus `not`. The
 * policy-bound schema therefore advertises the drafted/abstained rule in the
 * relevant property descriptions and applies `minItems` to any supplied claim
 * inventory. `parseDocumentationDecision` remains the enforcement boundary.
 */
function buildTerminalTool(profile: AgentTerminalProfile): ClaudeTool {
  const isPolicyBound = profile === "policy-bound";
  return {
    name: TERMINAL_TOOL_NAME,
    description: isPolicyBound
      ? "Finish the policy-bound Track task with a structured result. Drafted results require factualClaims; abstained results must omit factualClaims. This must be the final and only tool call in the turn."
      : "Finish the task with a structured result. This must be the final and only tool call in the turn.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "explanation", "inspectedPaths", "changeIds"],
      properties: {
        outcome: {
          type: "string",
          enum: ["drafted", "abstained"],
          ...(isPolicyBound
            ? {
                description:
                  "Use drafted only with one or more factualClaims. Use abstained only when factualClaims is omitted.",
              }
            : {}),
        },
        reason: {
          type: "string",
          ...(isPolicyBound
            ? {
                description:
                  "Required when outcome is abstained; omit this property when outcome is drafted.",
              }
            : {}),
          enum: [
            "already_documented",
            "insufficient_evidence",
            "internal_only",
            "unsupported_destination",
          ],
        },
        explanation: { type: "string", minLength: 1, maxLength: 500 },
        inspectedPaths: {
          type: "array",
          maxItems: 50,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 240 },
        },
        changeIds: {
          type: "array",
          maxItems: 500,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
        factualClaims: {
          type: "array",
          ...(isPolicyBound
            ? {
                minItems: 1,
                description:
                  "Required when outcome is drafted; omit this property when outcome is abstained.",
              }
            : {}),
          maxItems: 500,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "path",
              "startLine",
              "endLine",
              "changeIds",
              "evidenceReferenceIds",
            ],
            properties: {
              path: { type: "string", minLength: 1, maxLength: 512 },
              startLine: { type: "integer", minimum: 1, maximum: 1000000 },
              endLine: { type: "integer", minimum: 1, maximum: 1000000 },
              changeIds: {
                type: "array",
                minItems: 1,
                maxItems: 500,
                uniqueItems: true,
                items: { type: "string", minLength: 1, maxLength: 128 },
              },
              evidenceReferenceIds: {
                type: "array",
                minItems: 1,
                maxItems: 32,
                uniqueItems: true,
                items: { type: "string", minLength: 1, maxLength: 128 },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Smallest outer request-body limit across the models admitted by Track.
 *
 * Callers still enforce the raw context transport limit independently. This
 * limit applies to the complete JSON-framed request after prompts, tools, and
 * transcript messages have been added.
 */
export const TRACK_AGENT_REQUEST_MAX_BYTES = 1_000_000;
export const DEFAULT_AGENT_MAX_OUTPUT_TOKENS = 4_096;
export const TRACK_AGENT_MAX_OUTPUT_TOKENS = 64_000;
export const TRACK_AGENT_RESULT_MAX_BYTES = 1_000_000;
/** Total model turns admitted across every phase of one policy-bound run. */
export const TRACK_AGENT_MAX_TOTAL_STEPS = 32;
/** Maximum one tool result may add before JSON framing and transcript receipts. */
export const TRACK_AGENT_TOOL_RESULT_MAX_BYTES = 192 * 1_024;

const COMPACTED_MARKER = "thally-compacted-v1";
const RETRYABLE_WINDOW_TOOLS = new Set(["read_page", "read_api_spec"]);

/** Measure exactly the JSON body passed to the Anthropic-compatible client. */
export function agentRequestByteLength(request: AnthropicRequest): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8");
}

function assertRequestIsAdmitted(
  request: AnthropicRequest,
  maximumBytes: number | undefined,
): void {
  if (maximumBytes === undefined) return;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    agentRequestByteLength(request) > maximumBytes
  ) {
    throw new Error("agent_request_too_large");
  }
}

function contentDigest(value: unknown): { bytes: number; sha256: string } {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return {
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

function compactAssistantMessage(message: Message): void {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  const original = message.content;
  const compacted = original
    .filter((block) => block.type !== "text")
    .map((block) => {
      if (block.type !== "tool_use") return block;
      const digest = contentDigest(block.input);
      return {
        ...block,
        input: { [COMPACTED_MARKER]: digest },
      };
    });
  if (compacted.length > 0) {
    message.content = compacted;
    return;
  }
  const digest = contentDigest(original);
  message.content = [
    {
      type: "text",
      text: `${COMPACTED_MARKER}: assistant response consumed; bytes=${digest.bytes}; sha256=${digest.sha256}`,
    },
  ];
}

function compactConsumedToolResults(
  messages: Array<Message>,
  endExclusive: number,
): void {
  for (let index = 1; index < endExclusive; index += 1) {
    const message = messages[index]!;
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    message.content = message.content.map((block) => {
      if (
        block.type !== "tool_result" ||
        block.content.startsWith(`${COMPACTED_MARKER}:`)
      )
        return block;
      const digest = contentDigest(block.content);
      return {
        ...block,
        content: `${COMPACTED_MARKER}: result consumed; bytes=${digest.bytes}; sha256=${digest.sha256}`,
      };
    });
  }
}

function compactConsumedAssistantMessages(
  messages: Array<Message>,
  endExclusive: number,
): void {
  for (let index = 1; index < endExclusive; index += 1) {
    compactAssistantMessage(messages[index]!);
  }
}

function omittedToolResult(
  name: string,
  content: string,
  reason: "hard_limit" | "request_limit",
): ToolResultBlock {
  const digest = contentDigest(content);
  const isRetryableRead = RETRYABLE_WINDOW_TOOLS.has(name);
  const guidance = isRetryableRead
    ? " Retry the read with a smaller maxBytes value; never infer omitted content."
    : " The tool completed; do not repeat a mutation. Inspect its target with a bounded read if needed.";
  return {
    type: "tool_result",
    tool_use_id: "",
    content: `agent_tool_result_omitted: reason=${reason}; bytes=${digest.bytes}; sha256=${digest.sha256}.${guidance}`,
    is_error: isRetryableRead,
  };
}

interface PendingToolResult {
  name: string;
  block: ToolResultBlock;
}

function fitToolResults(input: {
  request: Omit<AnthropicRequest, "messages">;
  messages: Array<Message>;
  pending: Array<PendingToolResult>;
  maximumBytes?: number;
}): Array<ToolResultBlock> {
  const blocks = input.pending.map(({ name, block }) => {
    if (
      Buffer.byteLength(block.content, "utf8") <=
      TRACK_AGENT_TOOL_RESULT_MAX_BYTES
    )
      return block;
    return {
      ...omittedToolResult(name, block.content, "hard_limit"),
      tool_use_id: block.tool_use_id,
    };
  });
  if (input.maximumBytes === undefined) return blocks;

  const candidateMessages = [
    ...input.messages,
    { role: "user" as const, content: blocks },
  ];
  const byteLength = () =>
    agentRequestByteLength({ ...input.request, messages: candidateMessages });
  while (byteLength() > input.maximumBytes) {
    let largestIndex = -1;
    let largestBytes = -1;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (block.content.startsWith("agent_tool_result_omitted:")) continue;
      const bytes = Buffer.byteLength(block.content, "utf8");
      if (bytes > largestBytes) {
        largestBytes = bytes;
        largestIndex = index;
      }
    }
    if (largestIndex === -1) throw new Error("agent_task_not_representable");
    const pending = input.pending[largestIndex]!;
    blocks[largestIndex] = {
      ...omittedToolResult(
        pending.name,
        pending.block.content,
        "request_limit",
      ),
      tool_use_id: pending.block.tool_use_id,
    };
  }
  return blocks;
}

function safeClaimPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  return !value
    .split("/")
    .some(
      (part) =>
        !part || part === "." || part === ".." || part.toLowerCase() === ".git",
    );
}

function factualClaims(
  value: unknown,
): Array<DocumentationFactualClaim> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) return null;
  const claims: Array<DocumentationFactualClaim> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const claim = raw as Record<string, unknown>;
    if (
      Object.keys(claim).sort().join(",") !==
        "changeIds,endLine,evidenceReferenceIds,path,startLine" ||
      !safeClaimPath(claim.path) ||
      !Number.isSafeInteger(claim.startLine) ||
      (claim.startLine as number) < 1 ||
      (claim.startLine as number) > 1000000 ||
      !Number.isSafeInteger(claim.endLine) ||
      (claim.endLine as number) < (claim.startLine as number) ||
      (claim.endLine as number) > 1000000
    ) {
      return null;
    }
    const changeIds = boundedStrings(claim.changeIds, 500, 128);
    const evidenceReferenceIds = boundedStrings(
      claim.evidenceReferenceIds,
      32,
      128,
    );
    if (
      !changeIds ||
      changeIds.length === 0 ||
      !evidenceReferenceIds ||
      evidenceReferenceIds.length === 0
    )
      return null;
    claims.push({
      path: claim.path,
      startLine: claim.startLine as number,
      endLine: claim.endLine as number,
      changeIds,
      evidenceReferenceIds,
    });
  }
  return claims;
}

function boundedStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): Array<string> | null {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length < 1 ||
        item.length > maximumLength ||
        /[\u0000-\u001f\u007f]/u.test(item),
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return [...(value as Array<string>)];
}

/** Validate the model's terminal decision before it can affect run state. */
export function parseDocumentationDecision(
  value: Record<string, unknown>,
  terminalProfile: AgentTerminalProfile = "generic",
): DocumentationDecision | null {
  if (terminalProfile !== "generic" && terminalProfile !== "policy-bound")
    return null;
  const allowed = new Set([
    "outcome",
    "reason",
    "explanation",
    "inspectedPaths",
    "changeIds",
    "factualClaims",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const explanation = value.explanation;
  const inspectedPaths = boundedStrings(value.inspectedPaths, 50, 240);
  const changeIds = boundedStrings(value.changeIds, 500, 128);
  const claims = factualClaims(value.factualClaims);
  if (
    typeof explanation !== "string" ||
    explanation.length < 1 ||
    explanation.length > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(explanation) ||
    !inspectedPaths ||
    !changeIds ||
    !claims
  ) {
    return null;
  }
  const common = { explanation, inspectedPaths, changeIds };
  const isPolicyBound = terminalProfile === "policy-bound";
  if (
    value.outcome === "drafted" &&
    value.reason === undefined &&
    (isPolicyBound
      ? value.factualClaims !== undefined && claims.length > 0
      : value.factualClaims === undefined || claims.length > 0)
  ) {
    return {
      outcome: "drafted",
      ...common,
      ...(value.factualClaims === undefined ? {} : { factualClaims: claims }),
    };
  }
  if (
    value.outcome === "abstained" &&
    value.factualClaims === undefined &&
    [
      "already_documented",
      "insufficient_evidence",
      "internal_only",
      "unsupported_destination",
    ].includes(String(value.reason))
  ) {
    return {
      outcome: "abstained",
      reason: value.reason as Extract<
        DocumentationDecision,
        { outcome: "abstained" }
      >["reason"],
      ...common,
    };
  }
  return null;
}

/** Run until the model submits a validated terminal documentation decision. */
export async function runAgentLoop(input: LoopInput): Promise<{
  summary: string;
  steps: number;
  decision: DocumentationDecision;
}> {
  const messages: Array<Message> = [
    { role: "user", content: input.userPrompt },
  ];
  const maximumOutputTokens =
    input.maximumOutputTokens ?? DEFAULT_AGENT_MAX_OUTPUT_TOKENS;
  if (
    !Number.isSafeInteger(maximumOutputTokens) ||
    maximumOutputTokens < 1 ||
    maximumOutputTokens > TRACK_AGENT_MAX_OUTPUT_TOKENS
  ) {
    throw new Error("agent_output_limit_invalid");
  }
  let steps = 0;
  let summary = "";
  const terminalProfile = input.terminalProfile ?? "generic";
  if (terminalProfile !== "generic" && terminalProfile !== "policy-bound") {
    throw new Error("agent_terminal_profile_invalid");
  }
  const terminalTool = buildTerminalTool(terminalProfile);
  const advertisedToolNames = new Set(input.tools.map((tool) => tool.name));

  const requestBase: Omit<AnthropicRequest, "messages"> = {
    model: input.model,
    max_tokens: maximumOutputTokens,
    system: input.system,
    tools: [...input.tools, terminalTool],
  };

  while (steps < input.maxSteps) {
    steps++;
    // Policy-bound automation must always leave a durable structured result.
    // Reserve two attempts so one malformed terminal call can be repaired,
    // and use the provider's tool-choice contract to prevent another edit
    // from consuming the final session turn.
    const isForcedTerminalTurn =
      terminalProfile === "policy-bound" &&
      steps >= Math.max(1, input.maxSteps - 1);
    const request: AnthropicRequest = {
      ...requestBase,
      ...(isForcedTerminalTurn
        ? {
            tools: [terminalTool],
            tool_choice: {
              type: "tool" as const,
              name: TERMINAL_TOOL_NAME,
              disable_parallel_tool_use: true as const,
            },
          }
        : {}),
      messages,
    };
    // Track signs and transports context separately, but the model gateway
    // admits the complete Anthropic body. Measure the exact final framing on
    // every turn so JSON escaping or transcript growth can never trigger a
    // deterministic remote rejection after the session has spent authority.
    assertRequestIsAdmitted(request, input.maximumRequestBytes);
    const res = await input.client.messages.create(request);
    messages.push({ role: "assistant", content: res.content });
    // Everything before this response has now been consumed by the same model
    // session. Retain cryptographic receipts and tool-use IDs, but never carry
    // attacker-controlled repository text through every later request.
    compactConsumedAssistantMessages(messages, messages.length - 1);
    compactConsumedToolResults(messages, messages.length - 1);

    const text = res.content
      .filter(
        (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
      )
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) summary = text;

    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    const terminalUses = toolUses.filter(
      (use) => use.name === TERMINAL_TOOL_NAME,
    );
    if (terminalUses.length > 0) {
      const decision =
        terminalUses.length === 1 && toolUses.length === 1
          ? parseDocumentationDecision(terminalUses[0]!.input, terminalProfile)
          : null;
      if (decision) return { summary, steps, decision };
      const terminalContractGuidance =
        terminalProfile === "policy-bound"
          ? " Drafted results require between 1 and 500 factualClaims; abstained results must omit factualClaims."
          : "";
      const terminalErrors: Array<ToolResultBlock | ContentBlock> = [
        ...toolUses.map(
          (use): ToolResultBlock => ({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Error: submit_documentation_result must be one valid, standalone terminal call.${terminalContractGuidance}`,
            is_error: true,
          }),
        ),
        {
          type: "text",
          text: `Call submit_documentation_result once, by itself, with a bounded drafted or abstained decision.${terminalContractGuidance}`,
        },
      ];
      messages.push({
        role: "user",
        content: terminalErrors,
      });
      continue;
    }
    if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
      messages.push({
        role: "user",
        content:
          "Do not stop with prose. Call submit_documentation_result once with the final structured decision.",
      });
      continue;
    }

    const pending: Array<PendingToolResult> = [];
    for (const use of toolUses) {
      input.onEvent?.(
        terminalProfile === "policy-bound"
          ? advertisedToolNames.has(use.name)
            ? use.name
            : "unknown_tool"
          : `${use.name} ${JSON.stringify(use.input).slice(0, 100)}`,
      );
      let content: string;
      let isError = false;
      try {
        content = await input.dispatch(use.name, use.input);
      } catch (err) {
        content = `Error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      pending.push({
        name: use.name,
        block: {
          type: "tool_result",
          tool_use_id: use.id,
          content,
          is_error: isError,
        },
      });
    }
    const results = fitToolResults({
      request: requestBase,
      messages,
      pending,
      maximumBytes: input.maximumRequestBytes,
    });
    messages.push({ role: "user", content: results });
  }

  throw new Error("agent_result_missing");
}
