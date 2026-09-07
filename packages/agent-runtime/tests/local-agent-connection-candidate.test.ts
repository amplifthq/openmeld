import { describe, expect, it } from "vitest";
import { buildLocalAgentConnectionCandidateId } from "../src/local-agent-connection-candidate";

describe("local agent connection candidate identity", () => {
  it("preserves the existing wire identifier and distinguishes lanes and runtime replacement", () => {
    const target = {
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      runtimeLane: "canary",
      openMeldServiceRuntimeId: "runtime-1",
    };
    const id = buildLocalAgentConnectionCandidateId(target);
    expect(id).toBe("local-agent:device-1:canary:runtime-1:builtin%3Acodex");
    expect(
      buildLocalAgentConnectionCandidateId({ ...target, runtimeLane: "prod" })
    ).not.toBe(id);
    expect(
      buildLocalAgentConnectionCandidateId({
        ...target,
        openMeldServiceRuntimeId: "runtime-2",
      })
    ).not.toBe(id);
  });
});
