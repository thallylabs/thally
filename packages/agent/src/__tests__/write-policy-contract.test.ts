/**
 * Compatibility tests for the runtime-neutral policy contract entry point.
 */

import { describe, expect, it } from "vitest";

import {
  parseAgentWritePolicy,
  type AgentWritePolicyV2,
  type AgentWritePolicyV1,
} from "../write-policy-contract.js";
import { parseAgentWritePolicy as parseFromNodeApi } from "../write-policy.js";

function policy(
  overrides: Partial<AgentWritePolicyV1> = {},
): AgentWritePolicyV1 {
  return {
    version: 1,
    requiredPaths: ["src/content/api.mdx"],
    requiredChangeIds: ["change-1"],
    maximumFiles: 1,
    maximumBytes: 4_096,
    ...overrides,
  };
}

describe("Worker-safe write policy contract", () => {
  it("canonicalizes policy without changing the Node API result", () => {
    const input = policy({
      requiredPaths: ["src/content/z.mdx", "src/content/a.mdx"],
      requiredChangeIds: ["change-z", "change-a"],
      maximumFiles: 2,
    });
    const parsed = parseAgentWritePolicy(input);

    expect(parsed).toEqual(parseFromNodeApi(input));
    expect(parsed?.requiredPaths).toEqual([
      "src/content/a.mdx",
      "src/content/z.mdx",
    ]);
    expect(parsed?.requiredChangeIds).toEqual(["change-a", "change-z"]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.requiredPaths)).toBe(true);
    expect(Object.isFrozen(parsed?.requiredChangeIds)).toBe(true);
  });

  it.each([
    policy({ requiredPaths: ["src//content/api.mdx"] }),
    policy({ requiredPaths: ["src/content/./api.mdx"] }),
    policy({ requiredPaths: ["src/content/api.mdx/"] }),
    policy({ requiredPaths: ["src/content/../api.mdx"] }),
    policy({ requiredPaths: ["/src/content/api.mdx"] }),
    policy({ requiredPaths: ["src\\content\\api.mdx"] }),
    policy({ requiredPaths: ["src/.GiT/config"] }),
    policy({ requiredPaths: [`src/content/${"é".repeat(257)}.mdx`] }),
  ])(
    "rejects non-canonical, reserved, or oversized repository paths",
    (input) => {
      expect(parseAgentWritePolicy(input)).toBeNull();
    },
  );

  it("copies and freezes arrays instead of retaining controller-owned values", () => {
    const input = policy();
    const parsed = parseAgentWritePolicy(input)!;

    input.requiredPaths[0] = "src/content/attacker.mdx";
    input.requiredChangeIds[0] = "attacker";

    expect(parsed.requiredPaths).toEqual(["src/content/api.mdx"]);
    expect(parsed.requiredChangeIds).toEqual(["change-1"]);
  });

  it("parses and seals the versioned non-empty-subset revision authority", () => {
    const input: AgentWritePolicyV2 = {
      version: 2,
      requiredPaths: ["src/content/z.mdx", "src/content/a.mdx"],
      requiredChangeIds: ["change-z", "change-a"],
      maximumFiles: 2,
      maximumBytes: 4_096,
    };
    const parsed = parseAgentWritePolicy(input);

    input.requiredPaths[0] = "src/content/attacker.mdx";
    input.requiredChangeIds[0] = "attacker";

    expect(parsed).toMatchObject({
      version: 2,
      requiredPaths: ["src/content/a.mdx", "src/content/z.mdx"],
      requiredChangeIds: ["change-a", "change-z"],
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseAgentWritePolicy({ ...input, version: 3 })).toBeNull();
  });
});
