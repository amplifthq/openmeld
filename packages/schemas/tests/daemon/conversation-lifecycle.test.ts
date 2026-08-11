import { describe, expect, it } from "vitest";
import {
  agentControllerConversationResumePlanSchema,
  dispatchExecutionSchema,
  nextDispatchPlanSchema,
} from "../../src/index";

describe("daemon conversation lifecycle schemas", () => {
  it("accepts a plan that continues an existing agent controller conversation", () => {
    const result = agentControllerConversationResumePlanSchema.safeParse({
      status: "continue_existing",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown agent controller conversation resume plan status", () => {
    const result = agentControllerConversationResumePlanSchema.safeParse({
      status: "resume",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a next dispatch plan that recreates local runtime context for a new workspace", () => {
    const result = nextDispatchPlanSchema.safeParse({
      agentControllerConversationResume: {
        status: "continue_existing",
      },
      localRuntimeContext: {
        status: "recreate",
        reason: "workspace_changed",
      },
      bootstrap: {
        reason: "compatibility_recreate",
        status: "pending",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a dispatch execution that continues the agent controller conversation while recreating local runtime context", () => {
    const result = dispatchExecutionSchema.safeParse({
      agentControllerConversationResume: {
        status: "continued",
      },
      localRuntimeContext: {
        status: "recreated",
        reason: "workspace_changed",
      },
      bootstrap: {
        reason: null,
        status: "applied",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects legacy compatibility and continuity fields", () => {
    const result = dispatchExecutionSchema.safeParse({
      compatibilityAction: "reuse",
      compatibilityReason: "compatible",
      continuityStatus: "stable_resume",
      bootstrapApplied: false,
      bootstrapReason: null,
      bootstrapTemplateVersion: "compact-dispatch-bootstrap-v1",
      bootstrapContentFingerprint: "sha256:abc",
    });

    expect(result.success).toBe(false);
  });
});
