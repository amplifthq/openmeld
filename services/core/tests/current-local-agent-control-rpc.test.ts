import { describe, expect, it } from "vitest";
import { requireAcceptedLocalAgentControlPayload } from "../src/rpc/local-agent-control-policy";

describe("requireAcceptedLocalAgentControlPayload", () => {
  it("keeps daemon rejections as typed conflicts instead of schema failures", () => {
    expect(() =>
      requireAcceptedLocalAgentControlPayload({
        payload: {
          accepted: false,
          agentId: "codex",
          changed: false,
          enabled: true,
          message: "Codex cannot be disabled while it is handling a task.",
          reasonCode: "local_agent_control.busy",
          reportSyncStatus: "skipped",
          status: "rejected",
        },
        status: "accepted",
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          code: "local_agent_control.busy",
          message: "Codex cannot be disabled while it is handling a task.",
          status: 409,
        }),
      })
    );
  });

  it("maps Runtime Transport timeouts to a gateway timeout", () => {
    expect(() =>
      requireAcceptedLocalAgentControlPayload({
        message: "Runtime Transport did not answer local agent control.",
        reasonCode: "local_agent_control.timeout",
        status: "rejected",
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          code: "local_agent_control.timeout",
          message: "Runtime Transport did not answer local agent control.",
          status: 504,
        }),
      })
    );
  });

  it("returns accepted daemon payloads unchanged", () => {
    const payload = {
      accepted: true,
      agentId: "codex",
      changed: true,
      enabled: false,
      reportSyncStatus: "submitted",
      status: "updated",
    } as const;

    expect(
      requireAcceptedLocalAgentControlPayload({
        payload,
        status: "accepted",
      })
    ).toBe(payload);
  });
});
