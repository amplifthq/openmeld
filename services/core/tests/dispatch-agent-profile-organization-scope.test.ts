import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTargetBindingOrganizationScope } from "../src/dispatch/application/dispatch-execution-service";
import type { CoreBindings } from "../src/lib/bindings";

describe("dispatch Agent Profile Organization scope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a Binding whose Agent Profile belongs to the Space Organization without legacy Wake access", async () => {
    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-acme",
      env: createScopeEnv({
        authorizationId: null,
        profileOrganizationId: "org-acme",
        spaceOrganizationId: "org-acme",
      }),
      message: createDispatchMessage(),
    });

    expect(result).toEqual({ ok: true, organizationId: "org-acme" });
  });

  it("rejects a Binding whose Agent Profile belongs to another Organization even when legacy Wake access remains", async () => {
    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-personal",
      env: createScopeEnv({
        authorizationId: "legacy-authorization",
        profileOrganizationId: "org-personal",
        spaceOrganizationId: "org-acme",
      }),
      message: createDispatchMessage(),
    });

    expect(result).toMatchObject({
      errorCode: "agent_profile.organization_mismatch",
      finalStatus: "failed_terminal",
      ok: false,
    });
  });

  it("logs safe dispatch correlation when the Organization lookup fails", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-acme",
      env: createFailingScopeEnv(new Error("D1 lookup failed")),
      message: createDispatchMessage(),
    });

    expect(result).toMatchObject({
      errorCode: "agent_profile.organization_lookup_failed",
      finalStatus: "failed_retryable",
      ok: false,
    });
    expect(log).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.agent_profile_organization_lookup_failed]",
      {
        bindingId: "binding-acme",
        dispatchId: "dispatch-1",
        error: "D1 lookup failed",
        event:
          "core.openMeldDaemon.dispatch_execution.agent_profile_organization_lookup_failed",
        sourceEventId: "source-event-1",
        spaceId: "space-acme",
        targetProfileId: "agent-profile-1",
        taskId: "task-1",
      }
    );
  });
});

function createDispatchMessage(): OpenMeldDaemonDispatchQueueMessage {
  return {
    dispatchId: "dispatch-1",
    spaceId: "space-acme",
    sourceEventId: "source-event-1",
    targetProfileId: "agent-profile-1",
    taskId: "task-1",
  } as OpenMeldDaemonDispatchQueueMessage;
}

function createFailingScopeEnv(error: Error): CoreBindings {
  return {
    OPENMELD_DB: {
      prepare: () => {
        throw error;
      },
    } as unknown as D1Database,
  } as CoreBindings;
}

function createScopeEnv(input: {
  authorizationId: string | null;
  profileOrganizationId: string;
  spaceOrganizationId: string;
}): CoreBindings {
  return {
    OPENMELD_DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            authorization_id: input.authorizationId,
            organization_id: input.spaceOrganizationId,
            profile_organization_id: input.profileOrganizationId,
          }),
        }),
      }),
    } as unknown as D1Database,
  } as CoreBindings;
}
