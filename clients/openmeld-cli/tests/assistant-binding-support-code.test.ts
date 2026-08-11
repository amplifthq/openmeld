import { describe, expect, it } from "vitest";
import { selectAssistantBindingSupportCode } from "../src/system/assistant-binding-support-code";

describe("selectAssistantBindingSupportCode", () => {
  it("drops success-class codes and prefers a blocking code", () => {
    const supportCode = selectAssistantBindingSupportCode({
      reason: "local_execution_evidence_unavailable",
      reasonCodes: [
        "agent_profile_binding.command_eligible",
        "claim.not_checked",
        "route.not_registered",
      ],
    });

    expect(supportCode).toBe("route.not_registered");
  });

  it("prefers a blocking code even when a non-blocking meaningful code comes first", () => {
    const supportCode = selectAssistantBindingSupportCode({
      reason: null,
      reasonCodes: [
        "agent_profile_binding.command_eligible",
        "runtime.pending",
        "service.execution_incompatible",
      ],
    });

    expect(supportCode).toBe("service.execution_incompatible");
  });

  it("recognizes each blocking prefix (route, service, agent_execution, local_service)", () => {
    for (const blockingCode of [
      "route.offline",
      "service.execution_incompatible",
      "agent_execution.offline",
      "local_service.not_connected",
    ]) {
      expect(
        selectAssistantBindingSupportCode({
          reason: "local_execution_evidence_unavailable",
          reasonCodes: ["agent_profile_binding.command_eligible", blockingCode],
        })
      ).toBe(blockingCode);
    }
  });

  it("falls back to the first remaining meaningful code when nothing blocks", () => {
    const supportCode = selectAssistantBindingSupportCode({
      reason: "local_execution_evidence_unavailable",
      reasonCodes: [
        "claim.not_checked",
        "agent_profile_binding.execution_readiness_pending",
      ],
    });

    expect(supportCode).toBe(
      "agent_profile_binding.execution_readiness_pending"
    );
  });

  it("falls back to the reason field when only success-class codes remain", () => {
    const supportCode = selectAssistantBindingSupportCode({
      reason: "local_execution_evidence_unavailable",
      reasonCodes: [
        "agent_profile_binding.command_eligible",
        "claim.not_checked",
      ],
    });

    expect(supportCode).toBe("local_execution_evidence_unavailable");
  });

  it("ignores blank codes and trims surviving codes", () => {
    const supportCode = selectAssistantBindingSupportCode({
      reason: "  ",
      reasonCodes: ["   ", "agent_profile_binding.command_eligible"],
    });

    expect(supportCode).toBe("agent_profile_binding.unavailable");
  });

  it("uses the stable default when no code and no reason are available", () => {
    const supportCode = selectAssistantBindingSupportCode({
      reasonCodes: [],
    });

    expect(supportCode).toBe("agent_profile_binding.unavailable");
  });
});
