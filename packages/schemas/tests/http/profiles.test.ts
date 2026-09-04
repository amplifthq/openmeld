import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
  additionalHumanProfileCreationDisabledErrorResponseSchema,
  additionalHumanProfileCreationDisabledRpcErrorResponseSchema,
  authProfileViewSchema,
  profileCapabilitiesResponseSchema,
  updateAgentProfileDefaultProjectBodySchema,
} from "../../src";

const ORDINARY_AGENT_PROFILE = {
  openMeldProfileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
  profileName: "Research Agent",
  profileHandle: "research-agent",
  profileKind: "agent" as const,
  isDefault: false,
  status: "active" as const,
  ownerUserId: "user_1",
  source: "cli_create",
  managedRole: null,
  createdByUserId: "user_1",
  creatorProfileId: null,
  lastUsedAt: null,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

describe("Agent Profile Default Project contracts", () => {
  it("carries a nullable Default Project for an ordinary Agent Profile", () => {
    expect(
      authProfileViewSchema.parse({
        ...ORDINARY_AGENT_PROFILE,
        defaultProjectId: "project_alpha",
      }).defaultProjectId
    ).toBe("project_alpha");

    expect(
      authProfileViewSchema.parse({
        ...ORDINARY_AGENT_PROFILE,
        defaultProjectId: null,
      }).defaultProjectId
    ).toBeNull();
  });

  it.each([
    {
      ...ORDINARY_AGENT_PROFILE,
      profileKind: "human" as const,
    },
    {
      ...ORDINARY_AGENT_PROFILE,
      managedRole: "center_agent" as const,
    },
  ])("rejects Default Project data outside ordinary Agent Profiles", (profile) => {
    expect(
      authProfileViewSchema.safeParse({
        ...profile,
        defaultProjectId: "project_alpha",
      }).success
    ).toBe(false);
  });

  it("keeps the Default Project mutation strict", () => {
    expect(
      updateAgentProfileDefaultProjectBodySchema.parse({
        expectedOrganizationId: "org_alpha",
        defaultProjectId: "project_alpha",
      })
    ).toEqual({
      expectedOrganizationId: "org_alpha",
      defaultProjectId: "project_alpha",
    });
    expect(
      updateAgentProfileDefaultProjectBodySchema.parse({
        expectedOrganizationId: "org_alpha",
        defaultProjectId: null,
      })
    ).toEqual({
      expectedOrganizationId: "org_alpha",
      defaultProjectId: null,
    });
    expect(
      updateAgentProfileDefaultProjectBodySchema.safeParse({
        defaultProjectId: "project_alpha",
        expectedOrganizationId: "org_alpha",
        localPath: "/private/path",
      }).success
    ).toBe(false);
  });
});

describe("Profile capabilities contract", () => {
  it("owns the stable additional Human Profile creation rejection", () => {
    expect(ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE).toBe(
      "profile.additional_human_profile_creation_disabled"
    );
    expect(ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE).toBe(
      "Creating additional profiles for people is currently unavailable. Use your default profile, or create an Agent."
    );
    expect(
      additionalHumanProfileCreationDisabledErrorResponseSchema.parse({
        code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
        message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
        ok: false,
      })
    ).toEqual({
      code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
      message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
      ok: false,
    });
    expect(
      additionalHumanProfileCreationDisabledRpcErrorResponseSchema.parse({
        code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
        message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
        ok: false,
        status: 409,
      })
    ).toEqual({
      code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
      message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
      ok: false,
      status: 409,
    });
    expect(
      additionalHumanProfileCreationDisabledRpcErrorResponseSchema.safeParse({
        code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
        message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
        ok: false,
        status: 400,
      }).success
    ).toBe(false);
  });

  it("carries the Auth-owned additional Human Profile creation capability", () => {
    expect(
      profileCapabilitiesResponseSchema.parse({
        ok: true,
        additionalHumanProfileCreationEnabled: false,
      })
    ).toEqual({
      ok: true,
      additionalHumanProfileCreationEnabled: false,
    });
    expect(
      profileCapabilitiesResponseSchema.safeParse({
        ok: true,
        additionalHumanProfileCreationEnabled: true,
        clientOverride: true,
      }).success
    ).toBe(false);
  });
});
