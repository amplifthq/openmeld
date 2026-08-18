import { describe, expect, it } from "vitest";
import { centerAgentInviteSlackTeammatesRpcResponseSchema } from "../../src/schemas/runtime/slack-welcome-interaction";

describe("Center Agent Slack teammate invitation response", () => {
  it("returns agent-readable per-target outcomes", () => {
    expect(
      centerAgentInviteSlackTeammatesRpcResponseSchema.parse({
        manualInviteUrl: null,
        organizationName: "Ampli Lift",
        outcomes: [
          {
            displayName: "Maya",
            status: "delivered",
            targetSlackUserId: "U_MAYA",
          },
        ],
        status: "completed",
      })
    ).toMatchObject({
      outcomes: [{ displayName: "Maya", status: "delivered" }],
      status: "completed",
    });
  });

  it("rejects the old opaque acknowledgement", () => {
    expect(() =>
      centerAgentInviteSlackTeammatesRpcResponseSchema.parse({ handled: true })
    ).toThrow();
  });
});
