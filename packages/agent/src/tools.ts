import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools as mcpTools, getTool } from "@thallylabs/mcp/tools";

import {
  agentWriteToolTargets,
  isAgentWriteToolAuthorized,
  type AgentWritePolicy,
} from "./write-policy.js";

const EVIDENCE_REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function evidenceMarker(evidenceReferenceId: string): string {
  return `<!-- thally-cite:v1:${createHash("sha256")
    .update(`evidence\0${evidenceReferenceId}`, "utf8")
    .digest("hex")} -->`;
}

function writtenEvidenceLineRange(
  source: string,
  marker: string,
  citationAnchor: string,
): string | null {
  const lines = source.split("\n");
  const markerIndexes = lines.flatMap((line, index) =>
    line.replace(/\r$/u, "") === marker ? [index] : [],
  );
  if (markerIndexes.length !== 1) return null;
  const anchor = citationAnchor.trim();
  if (!anchor) return null;
  const anchorLineCount = anchor.split(/\r?\n/u).length;
  const markerLine = markerIndexes[0]! + 1;
  const startLine = markerLine - anchorLineCount;
  return startLine >= 1 ? `${startLine}-${markerLine}` : null;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * The safe authoring surface the agent exposes to Claude — explore + edit only.
 * Deliberately excludes scaffold/migrate/translate from the MCP registry: those
 * aren't "document a feature into an existing docs repo" operations.
 */
const AGENT_TOOL_NAMES = new Set([
  "list_pages",
  "read_page",
  "search_docs",
  "get_context",
  "add_page",
  "update_page",
  "replace_page_text",
  "read_api_spec",
  "update_api_spec",
  "add_tab",
]);

export interface ToolBridge {
  claudeTools: Array<ClaudeTool>;
  dispatch: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export interface ToolBridgeOptions {
  /** Exact controller-owned write authority for an evidence-backed run. */
  writePolicy?: Readonly<AgentWritePolicy>;
}

/**
 * Bridge the shared MCP registry to Claude tool-use: convert each tool's zod
 * schema to inlined JSON Schema (no $ref — Anthropic wants a plain object),
 * hide `projectDir` from the model, and inject it at call time.
 */
export function buildToolBridge(
  projectDir: string,
  options: ToolBridgeOptions = {},
): ToolBridge {
  const selected = mcpTools.filter((tool) => AGENT_TOOL_NAMES.has(tool.name));

  const claudeTools: Array<ClaudeTool> = selected.map((tool) => {
    // Cast the erased ZodObject<ZodRawShape> to a plain ZodType: its generic
    // recurses infinitely through zodToJsonSchema otherwise (TS2589).
    const schema = zodToJsonSchema(tool.schema as never, {
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    delete schema.$schema;
    const props = schema.properties as Record<string, unknown> | undefined;
    if (props) delete props.projectDir;
    if (Array.isArray(schema.required)) {
      schema.required = (schema.required as Array<string>).filter(
        (r) => r !== "projectDir",
      );
    }
    if (
      options.writePolicy &&
      (tool.name === "replace_page_text" || tool.name === "update_page")
    ) {
      if (props && tool.name === "update_page") {
        props.evidenceReferenceId = {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "Exact evidence reference ID supplied by Track.",
        };
        props.citationAnchor = {
          type: "string",
          minLength: 1,
          maxLength: 65536,
          description:
            "Exact unique new prose span after which Track should attach the evidence marker.",
        };
      }
      const required = Array.isArray(schema.required)
        ? (schema.required as Array<string>)
        : [];
      schema.required = [
        ...new Set([
          ...required,
          "evidenceReferenceId",
          ...(tool.name === "update_page" ? ["citationAnchor"] : []),
        ]),
      ];
    }
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema,
    };
  });

  const dispatch = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> => {
    const tool = getTool(name);
    if (!tool || !AGENT_TOOL_NAMES.has(name)) {
      return `Error: tool "${name}" is not available to the docs agent.`;
    }
    if (
      options.writePolicy &&
      !isAgentWriteToolAuthorized({
        projectDir,
        name,
        toolInput: input,
        policy: options.writePolicy,
      })
    ) {
      // Do not echo the rejected path or model input. Both are untrusted and
      // may contain private repository metadata or prompt-injection content.
      return "Error: this write is outside the controller-approved documentation plan.";
    }
    let toolInput = input;
    let evidenceLineRange: string | null = null;
    let marker: string | null = null;
    let evidenceTarget:
      { path: string; original: Buffer; citationAnchor: string } | undefined;
    if (
      options.writePolicy &&
      (name === "replace_page_text" || name === "update_page")
    ) {
      const evidenceReferenceId = input.evidenceReferenceId;
      if (
        typeof evidenceReferenceId !== "string" ||
        !EVIDENCE_REFERENCE_ID.test(evidenceReferenceId)
      ) {
        // The agent bridge invokes handlers directly, so the advertised Zod
        // schema is not an enforcement boundary. Reject before any write.
        return "Error: Track evidence binding is invalid.";
      }
      marker = evidenceMarker(evidenceReferenceId);
    }
    if (options.writePolicy && name === "update_page") {
      const citationAnchor = input.citationAnchor;
      const content = input.content;
      if (
        typeof citationAnchor !== "string" ||
        citationAnchor.trim().length === 0 ||
        typeof content !== "string" ||
        !marker ||
        content.includes(marker)
      ) {
        return "Error: Track evidence binding is invalid.";
      }
      const first = content.indexOf(citationAnchor);
      if (
        first < 0 ||
        content.indexOf(citationAnchor, first + citationAnchor.length) >= 0
      ) {
        return "Error: citationAnchor must match exactly one new prose span.";
      }
      const insertion = `${citationAnchor.replace(/\s*$/u, "")}\n${marker}`;
      const boundContent = `${content.slice(0, first)}${insertion}${content.slice(first + citationAnchor.length)}`;
      const targets = agentWriteToolTargets(projectDir, name, input);
      if (!targets || targets.length !== 1) {
        return "Error: Track evidence binding is invalid.";
      }
      const targetPath = resolve(projectDir, targets[0]!);
      try {
        evidenceTarget = {
          path: targetPath,
          original: readFileSync(targetPath),
          citationAnchor,
        };
      } catch {
        return "Error: Track evidence binding is invalid.";
      }
      toolInput = { ...input, content: boundContent };
      delete toolInput.evidenceReferenceId;
      delete toolInput.citationAnchor;
    }
    const result = await tool.handler({ ...toolInput, projectDir });
    if (evidenceTarget && marker) {
      try {
        evidenceLineRange = writtenEvidenceLineRange(
          readFileSync(evidenceTarget.path, "utf8"),
          marker,
          evidenceTarget.citationAnchor,
        );
      } catch {
        evidenceLineRange = null;
      }
      if (!evidenceLineRange) {
        // Keep a failed evidence receipt atomic with its mutation. A later
        // model turn must not inherit an unclaimable partial update.
        writeFileSync(evidenceTarget.path, evidenceTarget.original);
        return "Error: Track evidence binding is invalid.";
      }
    }
    return evidenceLineRange
      ? `${result}\nFinal evidence span lines: ${evidenceLineRange}. Use this exact range for the factual claim.`
      : result;
  };

  return { claudeTools, dispatch };
}
