import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { resolveRemoteAgentRuntimeAvailability } from "../src/remote-agent/application/remote-agent-runtime-policy";

describe("Remote Agent runtime policy", () => {
  it("fails closed when the global runtime flag is not enabled", () => {
    expect(
      resolveRemoteAgentRuntimeAvailability({
        env: {} as CoreBindings,
        organizationId: "org_1",
      })
    ).toEqual({
      ok: false,
      code: "remote_agent.runtime_disabled",
      message: "Center Agent isn't available right now. Try again in a moment.",
    });
  });

  it("blocks an explicitly blocked organization", () => {
    expect(
      resolveRemoteAgentRuntimeAvailability({
        env: {
          OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
          OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS:
            " org_0, org_1 , org_2 ",
        } as CoreBindings,
        organizationId: "org_1",
      })
    ).toEqual({
      ok: false,
      code: "remote_agent.organization_blocked",
      message:
        "Center Agent is unavailable for this Organization. Ask an Organization owner or admin for help.",
    });
  });

  it("allows any organization when the global flag is enabled and no blocked list is configured", () => {
    expect(
      resolveRemoteAgentRuntimeAvailability({
        env: {
          OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
        } as CoreBindings,
        organizationId: "org_1",
      })
    ).toEqual({ ok: true });
  });

  it("allows any organization not in the blocked list when the global flag is enabled", () => {
    expect(
      resolveRemoteAgentRuntimeAvailability({
        env: {
          OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
          OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS: "org_other",
        } as CoreBindings,
        organizationId: "org_1",
      })
    ).toEqual({ ok: true });
  });
});
