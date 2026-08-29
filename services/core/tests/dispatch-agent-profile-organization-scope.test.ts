import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveTargetBindingOrganizationScope } from "../src/dispatch/application/dispatch-execution-service";
import type { CoreBindings } from "../src/lib/bindings";

describe("dispatch Agent Profile Organization scope", () => {
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
});

function createDispatchMessage(): OpenMeldDaemonDispatchQueueMessage {
  return {
    spaceId: "space-acme",
    targetProfileId: "agent-profile-1",
  } as OpenMeldDaemonDispatchQueueMessage;
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
