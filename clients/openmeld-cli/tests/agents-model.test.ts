import { describe, expect, it } from "vitest";
import { createAgentRegistration } from "../src/agents/model";

describe("createAgentRegistration", () => {
  it("trims and returns normalized registration fields", () => {
    const registration = createAgentRegistration({
      agentId: "  codex  ",
      displayName: "  Codex Agent  ",
      timestamp: "2026-02-25T00:00:00.000Z",
    });

    expect(registration.agentId).toBe("codex");
    expect(registration.displayName).toBe("Codex Agent");
    expect(registration.transportMode).toBe("local-cli");
    expect(registration.streamingMode).toBe("final");
    expect(registration.timeoutMs).toBeNull();
    expect(registration.retry).toBe(0);
    expect(registration.contextIdMappingSpec).toEqual({
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
      mappingVersion: 1,
    });
    expect(registration.enabled).toBe(true);
    expect(registration.registeredAt).toBe("2026-02-25T00:00:00.000Z");
    expect(registration.updatedAt).toBe("2026-02-25T00:00:00.000Z");
  });

  it("throws when agentId is blank", () => {
    expect(() =>
      createAgentRegistration({
        agentId: "   ",
        displayName: "Codex",
      })
    ).toThrow("agents.config_invalid: agentId is required");
  });

  it("throws when displayName is blank", () => {
    expect(() =>
      createAgentRegistration({
        agentId: "codex",
        displayName: "   ",
      })
    ).toThrow("agents.config_invalid: displayName is required");
  });
});
