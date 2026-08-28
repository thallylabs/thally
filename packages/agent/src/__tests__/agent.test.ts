import { describe, it, expect } from "vitest";
import {
  agentRequestByteLength,
  DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
  parseDocumentationDecision,
  runAgentLoop,
  TRACK_AGENT_CONTEXT_MAX_BYTES,
  TRACK_AGENT_MAX_OUTPUT_TOKENS,
  TRACK_AGENT_REQUEST_MAX_BYTES,
  TRACK_AGENT_RESULT_MAX_BYTES,
  TRACK_AGENT_TOOL_RESULT_MAX_BYTES,
  type AnthropicLike,
  type AnthropicRequest,
  type CreateResponse,
} from "../agent";
import {
  assertCleanDocumentationResultIsValid,
  assertDocumentationDecisionMatchesState,
  createAgentTurnBudget,
} from "../run";
import { buildSystemPrompt, buildUserPrompt } from "../prompt";
import { buildToolBridge } from "../tools";

function stubClient(responses: Array<CreateResponse>): {
  client: AnthropicLike;
  calls: Array<AnthropicRequest>;
} {
  const calls: Array<AnthropicRequest> = [];
  let i = 0;
  const client: AnthropicLike = {
    messages: {
      create: async (body) => {
        calls.push(JSON.parse(JSON.stringify(body)) as AnthropicRequest);
        return (
          responses[i++] ?? {
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          }
        );
      },
    },
  };
  return { client, calls };
}

const base = {
  model: "m",
  maxSteps: 10,
  system: "s",
  userPrompt: "do it",
  tools: [] as never[],
};
const terminal = (
  input: Record<string, unknown>,
  id = "done",
): CreateResponse => ({
  content: [
    { type: "tool_use", id, name: "submit_documentation_result", input },
  ],
  stop_reason: "tool_use",
});

describe("runAgentLoop", () => {
  it("advertises a provider-compatible terminal tool schema", async () => {
    const { client, calls } = stubClient([
      terminal({
        outcome: "abstained",
        reason: "insufficient_evidence",
        explanation: "No grounded edit.",
        inspectedPaths: [],
        changeIds: [],
      }),
    ]);

    await runAgentLoop({ ...base, client, dispatch: async () => "unused" });

    const terminalTool = calls[0]!.tools!.find(
      (tool) => tool.name === "submit_documentation_result",
    )!;
    expect(terminalTool.input_schema).not.toHaveProperty("oneOf");
    expect(JSON.stringify(terminalTool.input_schema)).not.toContain('"not"');
    expect(terminalTool.input_schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["outcome", "explanation", "inspectedPaths", "changeIds"],
    });
  });

  it("advertises the policy-bound factual-claim contract on the first request", async () => {
    const { client, calls } = stubClient([
      terminal({
        outcome: "abstained",
        reason: "insufficient_evidence",
        explanation: "No grounded edit.",
        inspectedPaths: [],
        changeIds: [],
      }),
    ]);

    await runAgentLoop({
      ...base,
      client,
      terminalProfile: "policy-bound",
      dispatch: async () => "unused",
    });

    const terminalTool = calls[0]!.tools!.find(
      (tool) => tool.name === "submit_documentation_result",
    )!;
    expect(terminalTool.description).toContain(
      "Drafted results require factualClaims",
    );
    expect(terminalTool.input_schema).not.toHaveProperty("oneOf");
    expect(JSON.stringify(terminalTool.input_schema)).not.toContain('"not"');
    expect(terminalTool.input_schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["outcome", "explanation", "inspectedPaths", "changeIds"],
      properties: {
        factualClaims: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          description:
            "Required when outcome is drafted; omit this property when outcome is abstained.",
        },
      },
    });
  });

  it("repairs policy-bound drafted results that omit or empty factual claims", async () => {
    const common = {
      outcome: "drafted",
      explanation: "Updated the guide.",
      inspectedPaths: ["src/content/guide.mdx"],
      changeIds: ["change-1"],
    };
    const claim = {
      path: "src/content/guide.mdx",
      startLine: 12,
      endLine: 13,
      changeIds: ["change-1"],
      evidenceReferenceIds: ["evidence:guide"],
    };
    const { client, calls } = stubClient([
      terminal(common, "missing-claims"),
      terminal({ ...common, factualClaims: [] }, "empty-claims"),
      terminal({ ...common, factualClaims: [claim] }, "valid-claims"),
    ]);

    const result = await runAgentLoop({
      ...base,
      client,
      terminalProfile: "policy-bound",
      dispatch: async () => "unused",
    });

    expect(result).toMatchObject({
      steps: 3,
      decision: { outcome: "drafted", factualClaims: [claim] },
    });
    expect(calls).toHaveLength(3);
    for (const request of calls.slice(1)) {
      const schema = request.tools!.find(
        (tool) => tool.name === "submit_documentation_result",
      )!.input_schema;
      expect(schema).toMatchObject({
        properties: { factualClaims: { minItems: 1, maxItems: 500 } },
      });
    }
    expect(JSON.stringify(calls[1]!.messages)).toContain("missing-claims");
    expect(JSON.stringify(calls[2]!.messages)).toContain("empty-claims");
    expect(JSON.stringify(calls[1]!.messages)).toContain(
      "Drafted results require between 1 and 500 factualClaims",
    );
  });

  it("keeps the public output budget and admits Track's larger bounded result profile", async () => {
    const response = terminal({
      outcome: "abstained",
      reason: "insufficient_evidence",
      explanation: "No grounded edit.",
      inspectedPaths: [],
      changeIds: [],
    });
    const requested: Array<number> = [];
    const client: AnthropicLike = {
      messages: {
        create: async (body) => {
          requested.push(body.max_tokens);
          return response;
        },
      },
    };

    await runAgentLoop({ ...base, client, dispatch: async () => "unused" });
    await runAgentLoop({
      ...base,
      client,
      maximumOutputTokens: TRACK_AGENT_MAX_OUTPUT_TOKENS,
      dispatch: async () => "unused",
    });

    expect(requested).toEqual([
      DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
      TRACK_AGENT_MAX_OUTPUT_TOKENS,
    ]);
    await expect(
      runAgentLoop({
        ...base,
        client,
        maximumOutputTokens: TRACK_AGENT_MAX_OUTPUT_TOKENS + 1,
        dispatch: async () => "unused",
      }),
    ).rejects.toThrow("agent_output_limit_invalid");
    expect(requested).toHaveLength(2);
  });

  it("dispatches a tool call, feeds the result back, and requires a terminal decision", async () => {
    const { client, calls } = stubClient([
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "read_page",
            input: { pageId: "intro" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [
          { type: "text", text: "Updated the intro page." },
          {
            type: "tool_use",
            id: "done",
            name: "submit_documentation_result",
            input: {
              outcome: "drafted",
              explanation: "Updated intro.",
              inspectedPaths: ["src/content/intro.mdx"],
              changeIds: ["change-1"],
              factualClaims: [
                {
                  path: "src/content/intro.mdx",
                  startLine: 1,
                  endLine: 1,
                  changeIds: ["change-1"],
                  evidenceReferenceIds: ["evidence:1"],
                },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      },
    ]);
    const dispatched: Array<string> = [];
    const res = await runAgentLoop({
      ...base,
      client,
      dispatch: async (name) => {
        dispatched.push(name);
        return "page body";
      },
    });

    expect(dispatched).toEqual(["read_page"]);
    expect(res).toMatchObject({
      summary: "Updated the intro page.",
      steps: 2,
      decision: { outcome: "drafted" },
    });
    const lastMsg = calls[1].messages.at(-1)!;
    expect(
      (
        lastMsg.content as Array<{
          type: string;
          tool_use_id: string;
          content: string;
        }>
      )[0],
    ).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
      content: "page body",
    });
  });

  it("carries a 180 KiB read into the terminal turn", async () => {
    const payload = "x".repeat(180 * 1024);
    const requests: Array<AnthropicRequest> = [];
    let turn = 0;
    const client: AnthropicLike = {
      messages: {
        create: async (request) => {
          requests.push(
            JSON.parse(JSON.stringify(request)) as AnthropicRequest,
          );
          turn += 1;
          if (turn === 1) {
            return {
              content: [
                {
                  type: "tool_use",
                  id: "read-1",
                  name: "read_page",
                  input: { pageId: "large", maxBytes: 180 * 1024 },
                },
              ],
              stop_reason: "tool_use",
            };
          }
          return terminal({
            outcome: "abstained",
            reason: "already_documented",
            explanation: "The large page is current.",
            inspectedPaths: ["src/content/large.mdx"],
            changeIds: ["change-1"],
          });
        },
      },
    };

    await runAgentLoop({
      ...base,
      client,
      maximumRequestBytes: TRACK_AGENT_REQUEST_MAX_BYTES,
      dispatch: async () => payload,
    });

    expect(requests).toHaveLength(2);
    expect(agentRequestByteLength(requests[1]!)).toBeLessThanOrEqual(
      TRACK_AGENT_REQUEST_MAX_BYTES,
    );
    expect(JSON.stringify(requests[1]!.messages)).toContain(
      payload.slice(0, 1_000),
    );
  });

  it("omits an oversized result locally without a gateway rejection", async () => {
    const requests: Array<AnthropicRequest> = [];
    let turn = 0;
    const client: AnthropicLike = {
      messages: {
        create: async (request) => {
          requests.push(
            JSON.parse(JSON.stringify(request)) as AnthropicRequest,
          );
          turn += 1;
          return turn === 1
            ? {
                content: [
                  {
                    type: "tool_use",
                    id: "read-1",
                    name: "read_page",
                    input: { pageId: "huge" },
                  },
                ],
                stop_reason: "tool_use",
              }
            : terminal({
                outcome: "abstained",
                reason: "insufficient_evidence",
                explanation: "The requested window was too large.",
                inspectedPaths: [],
                changeIds: [],
              });
        },
      },
    };

    await runAgentLoop({
      ...base,
      client,
      maximumRequestBytes: TRACK_AGENT_REQUEST_MAX_BYTES,
      dispatch: async () => "z".repeat(TRACK_AGENT_TOOL_RESULT_MAX_BYTES + 1),
    });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.messages)).toContain(
      "agent_tool_result_omitted: reason=hard_limit",
    );
    expect(JSON.stringify(requests[1]!.messages)).toContain(
      '"input":{"pageId":"huge"}',
    );
    expect(agentRequestByteLength(requests[1]!)).toBeLessThanOrEqual(
      TRACK_AGENT_REQUEST_MAX_BYTES,
    );
  });

  it("omits a valid read window when exact JSON framing cannot carry it", async () => {
    const requests: Array<AnthropicRequest> = [];
    let turn = 0;
    const maximumRequestBytes = 200_000;
    const client: AnthropicLike = {
      messages: {
        create: async (request) => {
          requests.push(
            JSON.parse(JSON.stringify(request)) as AnthropicRequest,
          );
          turn += 1;
          return turn === 1
            ? {
                content: [
                  {
                    type: "tool_use",
                    id: "read-1",
                    name: "read_api_spec",
                    input: { maxBytes: 180 * 1024 },
                  },
                ],
                stop_reason: "tool_use",
              }
            : terminal({
                outcome: "abstained",
                reason: "insufficient_evidence",
                explanation: "A smaller source window is required.",
                inspectedPaths: [],
                changeIds: [],
              });
        },
      },
    };

    await runAgentLoop({
      ...base,
      userPrompt: "u".repeat(50_000),
      client,
      maximumRequestBytes,
      dispatch: async () => "w".repeat(180 * 1024),
    });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.messages)).toContain(
      "agent_tool_result_omitted: reason=request_limit",
    );
    expect(
      requests.every(
        (request) => agentRequestByteLength(request) <= maximumRequestBytes,
      ),
    ).toBe(true);
  });

  it("fails closed when even a bounded omission receipt cannot represent the task", async () => {
    const terminalResponse = terminal({
      outcome: "abstained",
      reason: "insufficient_evidence",
      explanation: "No grounded edit.",
      inspectedPaths: [],
      changeIds: [],
    });
    let exactInitialBytes = 0;
    await runAgentLoop({
      ...base,
      client: {
        messages: {
          create: async (request) => {
            exactInitialBytes = agentRequestByteLength(request);
            return terminalResponse;
          },
        },
      },
      dispatch: async () => "unused",
    });

    let remoteCalls = 0;
    await expect(
      runAgentLoop({
        ...base,
        client: {
          messages: {
            create: async () => {
              remoteCalls += 1;
              return {
                content: [
                  {
                    type: "tool_use",
                    id: "read-1",
                    name: "read_page",
                    input: { pageId: "large" },
                  },
                ],
                stop_reason: "tool_use",
              };
            },
          },
        },
        maximumRequestBytes: exactInitialBytes,
        dispatch: async () => "body",
      }),
    ).rejects.toThrow("agent_task_not_representable");
    expect(remoteCalls).toBe(1);
  });

  it("compacts consumed results while preserving one model session", async () => {
    const requests: Array<AnthropicRequest> = [];
    let turn = 0;
    const client: AnthropicLike = {
      messages: {
        create: async (request) => {
          requests.push(
            JSON.parse(JSON.stringify(request)) as AnthropicRequest,
          );
          turn += 1;
          if (turn <= 2) {
            return {
              content: [
                {
                  type: "tool_use",
                  id: `read-${turn}`,
                  name: "read_page",
                  input: { pageId: `page-${turn}` },
                },
              ],
              stop_reason: "tool_use",
            };
          }
          return terminal({
            outcome: "abstained",
            reason: "already_documented",
            explanation: "Both pages are current.",
            inspectedPaths: [
              "src/content/page-1.mdx",
              "src/content/page-2.mdx",
            ],
            changeIds: ["change-1"],
          });
        },
      },
    };

    await runAgentLoop({
      ...base,
      client,
      dispatch: async () => "r".repeat(180 * 1024),
    });

    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[1]!.messages)).toContain(
      '"input":{"pageId":"page-1"}',
    );
    const third = JSON.stringify(requests[2]!.messages);
    expect(third).toContain("thally-compacted-v1: result consumed");
    expect(third).toContain('"input":{"thally-compacted-v1"');
    expect(third).toContain('"input":{"pageId":"page-2"}');
    expect(third.split("r".repeat(180 * 1024))).toHaveLength(2);
  });

  it("feeds a tool failure back as an error result and keeps going", async () => {
    const { client, calls } = stubClient([
      {
        content: [
          { type: "tool_use", id: "t1", name: "update_page", input: {} },
        ],
        stop_reason: "tool_use",
      },
      terminal({
        outcome: "abstained",
        reason: "insufficient_evidence",
        explanation: "No grounded edit.",
        inspectedPaths: [],
        changeIds: [],
      }),
    ]);
    const res = await runAgentLoop({
      ...base,
      client,
      dispatch: async () => {
        throw new Error("page not found");
      },
    });

    const fedBack = (
      calls[1].messages.at(-1)!.content as Array<{
        is_error?: boolean;
        content: string;
      }>
    )[0];
    expect(fedBack).toMatchObject({ is_error: true });
    expect(fedBack.content).toContain("page not found");
    expect(res.decision).toMatchObject({
      outcome: "abstained",
      reason: "insufficient_evidence",
    });
  });

  it("redacts policy-bound tool inputs from progress events", async () => {
    const customerProse = "private customer prose";
    const events: Array<string> = [];
    const { client } = stubClient([
      {
        content: [
          {
            type: "tool_use",
            id: "write-1",
            name: "update_page",
            input: {
              pageId: "private/customer-path",
              content: customerProse,
              evidenceReferenceId: "evidence:private",
            },
          },
        ],
        stop_reason: "tool_use",
      },
      terminal({
        outcome: "abstained",
        reason: "insufficient_evidence",
        explanation: "No authorized edit completed.",
        inspectedPaths: [],
        changeIds: [],
      }),
    ]);

    await runAgentLoop({
      ...base,
      client,
      tools: [
        {
          name: "update_page",
          description: "Update one page.",
          input_schema: { type: "object" },
        },
      ],
      terminalProfile: "policy-bound",
      dispatch: async () => "Error: rejected",
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual(["update_page"]);
    expect(JSON.stringify(events)).not.toContain(customerProse);
    expect(JSON.stringify(events)).not.toContain("customer-path");
    expect(JSON.stringify(events)).not.toContain("evidence:private");
  });

  it("fails at maxSteps when the model never submits a terminal decision", async () => {
    const forever: CreateResponse = {
      content: [{ type: "tool_use", id: "t", name: "list_pages", input: {} }],
      stop_reason: "tool_use",
    };
    const client: AnthropicLike = { messages: { create: async () => forever } };
    await expect(
      runAgentLoop({
        ...base,
        client,
        maxSteps: 3,
        dispatch: async () => "ok",
      }),
    ).rejects.toThrow("agent_result_missing");
  });

  it("rejects prose-only completion until the structured terminal tool is called", async () => {
    const { client, calls } = stubClient([
      {
        content: [{ type: "text", text: "Nothing to do." }],
        stop_reason: "end_turn",
      },
      terminal({
        outcome: "abstained",
        reason: "already_documented",
        explanation: "The page is current.",
        inspectedPaths: ["src/content/intro.mdx"],
        changeIds: ["change-1"],
      }),
    ]);

    const result = await runAgentLoop({
      ...base,
      client,
      dispatch: async () => "unused",
    });

    expect(result.steps).toBe(2);
    expect(result.decision).toMatchObject({
      outcome: "abstained",
      reason: "already_documented",
    });
    expect(
      calls[1]!.messages.every(
        (message) =>
          !Array.isArray(message.content) || message.content.length > 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(calls[1]!.messages)).toContain("Nothing to do.");
  });

  it("acknowledges a malformed terminal tool call before requesting repair", async () => {
    const { client, calls } = stubClient([
      terminal(
        {
          outcome: "abstained",
          reason: "unknown",
          explanation: "No.",
          inspectedPaths: [],
          changeIds: [],
        },
        "bad-result",
      ),
      terminal(
        {
          outcome: "abstained",
          reason: "insufficient_evidence",
          explanation: "No grounded edit.",
          inspectedPaths: [],
          changeIds: [],
        },
        "good-result",
      ),
    ]);

    await runAgentLoop({ ...base, client, dispatch: async () => "unused" });

    const repair = calls[1].messages.at(-1)!.content as Array<{
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: string;
      text?: string;
    }>;
    expect(repair[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "bad-result",
      is_error: true,
      content:
        "Error: submit_documentation_result must be one valid, standalone terminal call.",
    });
    expect(repair[1]).toEqual({
      type: "text",
      text: "Call submit_documentation_result once, by itself, with a bounded drafted or abstained decision.",
    });
  });

  it("admits the exact outer request boundary and rejects one byte over before the gateway call", async () => {
    const response = terminal({
      outcome: "abstained",
      reason: "insufficient_evidence",
      explanation: "No grounded edit.",
      inspectedPaths: [],
      changeIds: [],
    });
    let observed: AnthropicRequest | undefined;
    const observer: AnthropicLike = {
      messages: {
        create: async (body) => {
          // The loop appends to its message array after each response. Capture
          // the exact body as it existed at the client boundary.
          observed = JSON.parse(JSON.stringify(body)) as AnthropicRequest;
          return response;
        },
      },
    };
    const framed = {
      ...base,
      system: 'system with "quotes" and \\slashes',
      userPrompt: "context with é and a control character:\u0001",
      dispatch: async () => "unused",
    };
    await runAgentLoop({ ...framed, client: observer });
    expect(observed).toBeDefined();
    const exactBytes = agentRequestByteLength(observed!);

    let admittedCalls = 0;
    const admitted: AnthropicLike = {
      messages: {
        create: async () => {
          admittedCalls += 1;
          return response;
        },
      },
    };
    await expect(
      runAgentLoop({
        ...framed,
        client: admitted,
        maximumRequestBytes: exactBytes,
      }),
    ).resolves.toMatchObject({ decision: { outcome: "abstained" } });
    expect(admittedCalls).toBe(1);

    let rejectedCalls = 0;
    const rejected: AnthropicLike = {
      messages: {
        create: async () => {
          rejectedCalls += 1;
          return response;
        },
      },
    };
    await expect(
      runAgentLoop({
        ...framed,
        client: rejected,
        maximumRequestBytes: exactBytes - 1,
      }),
    ).rejects.toThrow("agent_request_too_large");
    expect(rejectedCalls).toBe(0);
  });

  it("fits the worst-case sealed JSON context inside the real Track request manifest", async () => {
    const context = '\\"'.repeat(TRACK_AGENT_CONTEXT_MAX_BYTES / 2);
    expect(Buffer.byteLength(context, "utf8")).toBe(
      TRACK_AGENT_CONTEXT_MAX_BYTES,
    );
    const bridge = buildToolBridge(process.cwd());
    let requestBytes = 0;
    const client: AnthropicLike = {
      messages: {
        create: async (request) => {
          requestBytes = agentRequestByteLength(request);
          return terminal({
            outcome: "abstained",
            reason: "insufficient_evidence",
            explanation: "No grounded edit.",
            inspectedPaths: [],
            changeIds: [],
          });
        },
      },
    };

    await runAgentLoop({
      client,
      model: "thally-managed",
      maxSteps: 1,
      system: buildSystemPrompt("x".repeat(8_000)),
      userPrompt: buildUserPrompt({
        instruction:
          "Apply only the exact sealed Track vNext documentation plan.",
        context,
        source: "track",
      }),
      tools: bridge.claudeTools,
      maximumOutputTokens: TRACK_AGENT_MAX_OUTPUT_TOKENS,
      maximumRequestBytes: TRACK_AGENT_REQUEST_MAX_BYTES,
      dispatch: bridge.dispatch,
    });

    expect(requestBytes).toBeLessThanOrEqual(TRACK_AGENT_REQUEST_MAX_BYTES);
    expect(TRACK_AGENT_REQUEST_MAX_BYTES - requestBytes).toBeGreaterThan(
      100_000,
    );
  });
});

describe("documentation factual claim protocol", () => {
  it("accepts the policy maximum of 500 bounded change IDs", () => {
    const changeIds = Array.from(
      { length: 500 },
      (_, index) =>
        `change-${index.toString().padStart(3, "0")}-${"x".repeat(117)}`,
    );
    expect(changeIds.every((id) => id.length === 128)).toBe(true);
    const parsed = parseDocumentationDecision({
      outcome: "drafted",
      explanation: "Updated the authorized documentation.",
      inspectedPaths: [],
      changeIds,
      factualClaims: [
        {
          path: "src/content/api.mdx",
          startLine: 1,
          endLine: 1,
          changeIds,
          evidenceReferenceIds: ["evidence:1"],
        },
      ],
    });
    expect(parsed).toMatchObject({ outcome: "drafted", changeIds });
    const resultBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8");
    expect(resultBytes).toBeGreaterThan(DEFAULT_AGENT_MAX_OUTPUT_TOKENS * 4);
    expect(resultBytes).toBeLessThanOrEqual(TRACK_AGENT_RESULT_MAX_BYTES);
  });

  it("keeps factual claims optional for ordinary drafts and forbids empty inventories", () => {
    const common = {
      explanation: "Finished.",
      inspectedPaths: ["src/content/a.mdx"],
      changeIds: [],
    };
    expect(
      parseDocumentationDecision({ outcome: "drafted", ...common }),
    ).toEqual({ outcome: "drafted", ...common });
    expect(
      parseDocumentationDecision({
        outcome: "drafted",
        ...common,
        factualClaims: [],
      }),
    ).toBeNull();
    expect(
      parseDocumentationDecision({
        outcome: "abstained",
        reason: "already_documented",
        ...common,
        factualClaims: [],
      }),
    ).toBeNull();
  });

  it("requires non-empty claims only for policy-bound drafts and forbids them on abstention", () => {
    const common = {
      explanation: "Finished.",
      inspectedPaths: ["src/content/a.mdx"],
      changeIds: ["change-1"],
    };
    const factualClaims = [
      {
        path: "src/content/a.mdx",
        startLine: 1,
        endLine: 1,
        changeIds: ["change-1"],
        evidenceReferenceIds: ["evidence:1"],
      },
    ];

    expect(
      parseDocumentationDecision(
        { outcome: "drafted", ...common },
        "policy-bound",
      ),
    ).toBeNull();
    expect(
      parseDocumentationDecision(
        { outcome: "drafted", ...common, factualClaims: [] },
        "policy-bound",
      ),
    ).toBeNull();
    expect(
      parseDocumentationDecision(
        { outcome: "drafted", ...common, factualClaims },
        "policy-bound",
      ),
    ).toEqual({ outcome: "drafted", ...common, factualClaims });
    expect(
      parseDocumentationDecision(
        {
          outcome: "abstained",
          reason: "already_documented",
          ...common,
          factualClaims,
        },
        "policy-bound",
      ),
    ).toBeNull();
  });

  it("accepts the full writer-policy change identity authority", () => {
    const changeIds = Array.from(
      { length: 500 },
      (_, index) => `triage:v1:${index.toString(16).padStart(64, "0")}`,
    );

    expect(
      parseDocumentationDecision({
        outcome: "abstained",
        reason: "already_documented",
        explanation: "Every planned change is already documented.",
        inspectedPaths: [],
        changeIds,
      }),
    ).toMatchObject({ changeIds });
  });

  it("rejects change identity counts and lengths outside writer authority", () => {
    const base = {
      outcome: "abstained",
      reason: "already_documented",
      explanation: "Already documented.",
      inspectedPaths: [],
    };
    expect(
      parseDocumentationDecision({
        ...base,
        changeIds: Array.from({ length: 501 }, (_, index) => `change-${index}`),
      }),
    ).toBeNull();
    expect(
      parseDocumentationDecision({ ...base, changeIds: ["x".repeat(129)] }),
    ).toBeNull();
  });

  it("accepts bounded exact line claims and copies their evidence identities", () => {
    const raw = {
      outcome: "drafted",
      explanation: "Updated the retry behavior.",
      inspectedPaths: ["src/content/retries.mdx"],
      changeIds: ["change-1"],
      factualClaims: [
        {
          path: "src/content/retries.mdx",
          startLine: 12,
          endLine: 13,
          changeIds: ["change-1"],
          evidenceReferenceIds: ["evidence:retry"],
        },
      ],
    };

    const parsed = parseDocumentationDecision(raw);
    raw.factualClaims[0]!.changeIds[0] = "change-attacker";
    raw.factualClaims[0]!.evidenceReferenceIds[0] = "evidence:attacker";

    expect(parsed).toMatchObject({
      outcome: "drafted",
      factualClaims: [
        { changeIds: ["change-1"], evidenceReferenceIds: ["evidence:retry"] },
      ],
    });
  });

  it.each([
    {
      path: "../secrets",
      startLine: 1,
      endLine: 1,
      changeIds: ["change-1"],
      evidenceReferenceIds: ["e:1"],
    },
    {
      path: "src/content/a.mdx",
      startLine: 0,
      endLine: 1,
      changeIds: ["change-1"],
      evidenceReferenceIds: ["e:1"],
    },
    {
      path: "src/content/a.mdx",
      startLine: 4,
      endLine: 3,
      changeIds: ["change-1"],
      evidenceReferenceIds: ["e:1"],
    },
    {
      path: "src/content/a.mdx",
      startLine: 1,
      endLine: 1,
      changeIds: [],
      evidenceReferenceIds: ["e:1"],
    },
    {
      path: "src/content/a.mdx",
      startLine: 1,
      endLine: 1,
      changeIds: ["change-1", "change-1"],
      evidenceReferenceIds: ["e:1"],
    },
    {
      path: "src/content/a.mdx",
      startLine: 1,
      endLine: 1,
      changeIds: ["change-1"],
      evidenceReferenceIds: [],
    },
  ])("rejects malformed factual claims", (claim) => {
    expect(
      parseDocumentationDecision({
        outcome: "drafted",
        explanation: "Updated docs.",
        inspectedPaths: ["src/content/a.mdx"],
        changeIds: ["change-1"],
        factualClaims: [claim],
      }),
    ).toBeNull();
  });
});

describe("post-repair documentation result state", () => {
  const drafted = {
    outcome: "drafted" as const,
    explanation: "Updated the guide.",
    inspectedPaths: ["src/content/guide.mdx"],
    changeIds: ["change-1"],
  };
  const abstained = {
    outcome: "abstained" as const,
    reason: "already_documented" as const,
    explanation: "The rejected edit was unnecessary, so the repair removed it.",
    inspectedPaths: ["src/content/guide.mdx"],
    changeIds: ["change-1"],
  };

  it("accepts a repair that removes every edit and explicitly abstains", () => {
    expect(() =>
      assertDocumentationDecisionMatchesState(abstained, false),
    ).not.toThrow();
  });

  it("accepts a dirty repair only when it reports a drafted result", () => {
    expect(() =>
      assertDocumentationDecisionMatchesState(drafted, true),
    ).not.toThrow();
  });

  it("rejects stale post-repair decisions that disagree with git state", () => {
    expect(() =>
      assertDocumentationDecisionMatchesState(drafted, false),
    ).toThrow("agent_result_invalid");
    expect(() =>
      assertDocumentationDecisionMatchesState(abstained, true),
    ).toThrow("agent_result_invalid");
  });

  it("rejects a clean abstention when post-repair validation still failed", () => {
    expect(() =>
      assertCleanDocumentationResultIsValid({
        ok: false,
        errors: ["Navigation remains invalid."],
        warnings: [],
      }),
    ).toThrow("agent_validation_failed");
    expect(() =>
      assertCleanDocumentationResultIsValid({
        ok: true,
        errors: [],
        warnings: [],
      }),
    ).not.toThrow();
  });
});

describe("policy-bound total turn budget", () => {
  it("admits 23 plus 9 turns and denies a thirty-third before execution", async () => {
    const admitted: Array<number> = [];
    const budget = createAgentTurnBudget(24, 32);

    await budget.run(async (maximumSteps) => {
      admitted.push(maximumSteps);
      return { steps: 23 };
    });
    await budget.run(async (maximumSteps) => {
      admitted.push(maximumSteps);
      return { steps: 9 };
    });
    await expect(
      budget.run(async (maximumSteps) => {
        admitted.push(maximumSteps);
        return { steps: 1 };
      }),
    ).rejects.toThrow("agent_total_step_limit_exceeded");

    expect(admitted).toEqual([24, 9]);
  });

  it("leaves generic per-loop turn behavior unchanged", async () => {
    const admitted: Array<number> = [];
    const budget = createAgentTurnBudget(40);
    for (const steps of [40, 40]) {
      await budget.run(async (maximumSteps) => {
        admitted.push(maximumSteps);
        return { steps };
      });
    }
    expect(admitted).toEqual([40, 40]);
  });
});
