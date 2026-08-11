import { describe, expect, it } from "vitest";
import { contextAuditFields } from "../src";

describe("gateway-contract audit", () => {
  it("builds audit context fields from canonical OpenMeld request context", () => {
    const fields = contextAuditFields({
      actorContext: {
        requestId: "req-3",
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
        profileKind: "agent",
        profileName: "Codex Agent",
      },
      agentControllerConversationId: "ctx-1",
    });

    expect(fields).toEqual({
      requestId: "req-3",
      openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
      profileKind: "agent",
    });
  });

  it("omits optional fields when not provided", () => {
    const fields = contextAuditFields({
      actorContext: {
        requestId: "req-2",
        openMeldProfileId: "hum_22222222-2222-4222-8222-222222222222",
        profileKind: "human",
      },
    });

    expect(fields).toEqual({
      requestId: "req-2",
      openMeldProfileId: "hum_22222222-2222-4222-8222-222222222222",
      profileKind: "human",
    });
  });
});
