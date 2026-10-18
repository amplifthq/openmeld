import { describe, expect, it, vi } from "vitest";

// Agent Profile deletion asks Core's sensitive operation gate first
// (member-agent-program.md §6) and reports its outcome.

vi.mock("@openmeld/schemas", async (importActual) => ({
  ...(await importActual<typeof import("@openmeld/schemas")>()),
  MEMBER_AGENTS_ENABLED: true,
}));

const { guardAgentProfileDeletion } = await import(
  "../src/lib/profiles/sensitive-profile-deletion"
);

const DECISION = {
  chainRootProfileId: null,
  confirmationId: null,
  sourceKind: "web_session" as const,
  taskExecutionId: null,
};

function context(input: {
  authorization?: string;
  authorize: unknown;
  profile?: Record<string, unknown> | null;
  session?: Record<string, unknown>;
}) {
  const core = {
    authorizeSensitiveOperation: vi.fn(async () => input.authorize),
    recordSensitiveOperationOutcome: vi.fn(async () => ({ ok: true })),
  };
  const c = {
    env: { OPENMELD_CORE_WORKER: core },
    json: (body: unknown, status: number) => Response.json(body, { status }),
    req: {
      raw: new Request("https://auth.openmeld.test/v1/profiles/agt_1", {
        headers: input.authorization
          ? { authorization: input.authorization }
          : {},
        method: "DELETE",
      }),
    },
    var: {
      profileService: {
        resolveProfileById: vi.fn(async () =>
          input.profile === undefined
            ? {
                organizationId: "org-1",
                ownerUserId: "user-1",
                profileId: "agt_1",
                profileKind: "agent",
              }
            : input.profile
        ),
      },
      session: input.session ?? { id: "session-1" },
    },
  };
  return { c, core };
}

describe("Agent Profile deletion guard", () => {
  it("asks Core with the session's credential kind and records the outcome", async () => {
    const { c, core } = context({
      authorize: { decision: DECISION, status: "allowed" },
    });
    const guard = await guardAgentProfileDeletion(c as never, {
      profileId: "agt_1",
      userId: "user-1",
    });
    expect(guard).not.toBeInstanceOf(Response);
    expect(core.authorizeSensitiveOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt_1",
        credential: { kind: "interactive_session" },
        operation: "profile_delete",
      })
    );
    await (guard as { record: (outcome: "succeeded") => Promise<void> }).record(
      "succeeded"
    );
    expect(core.recordSensitiveOperationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ decision: DECISION, outcome: "succeeded" })
    );
  });

  it("answers with Core's refusal and never deletes", async () => {
    const { c, core } = context({
      authorization: "Bearer cli-token",
      authorize: {
        code: "credential_confirmation.required",
        httpStatus: 409,
        message: "Confirm this change in your OpenMeld Inbox.",
        status: "refused",
      },
    });
    const response = await guardAgentProfileDeletion(c as never, {
      profileId: "agt_1",
      userId: "user-1",
    });
    expect(core.authorizeSensitiveOperation).toHaveBeenCalledWith(
      expect.objectContaining({ credential: { kind: "cli_credential" } })
    );
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(409);
    await expect((response as Response).json()).resolves.toMatchObject({
      code: "credential_confirmation.required",
    });
  });

  it("treats a session a CLI held as the CLI credential", async () => {
    const { c, core } = context({
      authorize: { decision: DECISION, status: "allowed" },
      session: { cliCredentialAt: new Date(), id: "session-1" },
    });
    await guardAgentProfileDeletion(c as never, {
      profileId: "agt_1",
      userId: "user-1",
    });
    expect(core.authorizeSensitiveOperation).toHaveBeenCalledWith(
      expect.objectContaining({ credential: { kind: "cli_credential" } })
    );
  });

  it("leaves a Human Profile or another owner's Profile to the deletion itself", async () => {
    for (const profile of [
      {
        organizationId: null,
        ownerUserId: "user-1",
        profileId: "h",
        profileKind: "human",
      },
      {
        organizationId: "org-1",
        ownerUserId: "user-2",
        profileId: "agt_1",
        profileKind: "agent",
      },
    ]) {
      const { c, core } = context({ authorize: null, profile });
      await guardAgentProfileDeletion(c as never, {
        profileId: String(profile.profileId),
        userId: "user-1",
      });
      expect(core.authorizeSensitiveOperation).not.toHaveBeenCalled();
    }
  });
});
