import { describe, expect, it } from "vitest";
import {
  agentControllerConversationCapabilitySchema,
  BUILTIN_AGENT_CONTROLLER_CONVERSATION_CAPABILITY_BY_CONTROLLER_ID,
  BUILTIN_AGENT_CONTROLLER_CONVERSATION_KIND_BY_CONTROLLER_ID,
  resolveBuiltinAgentControllerConversationCapability,
} from "../../src/index";

describe("agent controller conversation capability schema", () => {
  it("accepts the builtin codex capability shape", () => {
    const result = agentControllerConversationCapabilitySchema.safeParse({
      discover: "unsupported",
      externalImport: "by_ref_id",
      resume: "by_ref_id",
      turnOverride: "unsupported",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown capability values", () => {
    const result = agentControllerConversationCapabilitySchema.safeParse({
      discover: "unsupported",
      externalImport: "manual",
      resume: "by_ref_id",
      turnOverride: "unsupported",
    });

    expect(result.success).toBe(false);
  });

  it("resolves builtin agent controller capabilities", () => {
    expect(
      resolveBuiltinAgentControllerConversationCapability("codex")
    ).toEqual({
      discover: "unsupported",
      externalImport: "by_ref_id",
      resume: "by_ref_id",
      turnOverride: "unsupported",
    });
    expect(
      resolveBuiltinAgentControllerConversationCapability("claude-code")
    ).toEqual({
      discover: "unsupported",
      externalImport: "by_ref_id",
      resume: "by_ref_id",
      turnOverride: "unsupported",
    });
    expect(
      resolveBuiltinAgentControllerConversationCapability("openclaw")
    ).toEqual({
      discover: "unsupported",
      externalImport: "unsupported",
      resume: "by_ref_id",
      turnOverride: "unsupported",
    });
    expect(
      resolveBuiltinAgentControllerConversationCapability("opencode")
    ).toEqual({
      discover: "unsupported",
      externalImport: "unsupported",
      resume: "by_ref_id",
      turnOverride: "unsupported",
    });
    expect(
      resolveBuiltinAgentControllerConversationCapability("custom")
    ).toBeNull();
  });

  it("keeps builtin capability coverage aligned with builtin conversation kinds", () => {
    expect(
      Object.keys(
        BUILTIN_AGENT_CONTROLLER_CONVERSATION_CAPABILITY_BY_CONTROLLER_ID
      ).sort()
    ).toEqual(
      Object.keys(
        BUILTIN_AGENT_CONTROLLER_CONVERSATION_KIND_BY_CONTROLLER_ID
      ).sort()
    );
  });
});
