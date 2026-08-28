import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

export type AgentExecutionAuthority = "trusted-local" | "sealed-controller";
export const MAX_AGENTS_GUIDANCE_BYTES = 8_000;

function readAgentsGuidanceFile(filePath: string): string | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_AGENTS_GUIDANCE_BYTES)
      return null;
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== metadata.size) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Load the docs project's AGENTS.md — style rules, never-touch files, review
 * requirements — to steer a trusted local CLI run. Freeform markdown is never
 * loaded for automated or sealed execution. Empty string when absent.
 */
export function loadAgentsGuidance(projectDir: string): string {
  for (const name of ["AGENTS.md", ".github/AGENTS.md"]) {
    const filePath = path.join(projectDir, name);
    const guidance = readAgentsGuidanceFile(filePath);
    if (guidance !== null) return guidance;
  }
  return "";
}

/**
 * Return repository guidance only when the human running the local CLI owns
 * that instruction source. A sealed controller constrains tools and paths, but
 * it cannot make freeform repository prose trustworthy, so managed Track runs
 * omit AGENTS.md rather than elevate it into the model's system role.
 */
export function loadSystemPromptAgentsGuidance(
  projectDir: string,
  authority: AgentExecutionAuthority,
): string {
  return authority === "sealed-controller"
    ? ""
    : loadAgentsGuidance(projectDir);
}
