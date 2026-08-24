import { describe, expect, it, vi } from "vitest";
import { recordCenterAgentLocalAgentRequest } from "../src/center-agent/application/center-agent-interaction-audit-service";

describe("recordCenterAgentLocalAgentRequest", () => {
  it("records stable requester and client attribution without the local session", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));

    await recordCenterAgentLocalAgentRequest({
      actorProfileId: "agt_center",
      db: { prepare } as unknown as D1Database,
      deliveryId: "delivery-1",
      nowMs: 123,
      organizationId: "org-1",
      representedMember: {
        displayName: "Mira",
        profileId: "human-1",
        userId: "user-1",
      },
      source: {
        client: "codex",
        kind: "local_agent",
        sessionId: "private-thread-id",
      },
    });

    expect(bind).toHaveBeenCalledWith(
      "local-agent-request:delivery-1",
      "org-1",
      "agt_center",
      "receive_local_agent_request",
      "human-1",
      "user-1",
      "Mira",
      "local_agent_client",
      "codex",
      "delivery-1",
      null,
      123
    );
    expect(JSON.stringify(bind.mock.calls)).not.toContain("private-thread-id");
    expect(run).toHaveBeenCalledOnce();
  });
});
