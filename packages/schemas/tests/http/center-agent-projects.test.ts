import { describe, expect, it } from "vitest";
import {
  centerAgentCreateProjectToolRpcInputSchema,
  centerAgentListProjectsToolResponseSchema,
  centerAgentPrepareRemoveProjectToolResponseSchema,
  centerAgentSetAgentProfileDefaultProjectToolRpcInputSchema,
} from "../../src/schemas/http/center-agent-projects";

const speakerMember = {
  memberId: "member_1",
  userId: "user_1",
};
const context = {
  activeOrganizationId: "organization_1",
  actorContext: {
    agentControllerRef: "hosted:center-agent",
    callerPrincipalId: "center_agent_owner_1",
    ownerUserId: "center_agent_owner_1",
    profileKind: "agent" as const,
    requestId: "request_center_agent_projects",
    openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
  },
};

describe("Center Agent Project tool contracts", () => {
  it("accepts a represented-member create request without caller-owned Organization authority", () => {
    expect(
      centerAgentCreateProjectToolRpcInputSchema.safeParse({
        context,
        executionMode: "interactive",
        name: "OpenMeld",
        operationId: "create-openmeld-repository",
        repositoryUrl: "https://github.com/amplifthq/openmeld",
        speakerMember,
      })
    ).toMatchObject({ success: true });
  });

  it.each([
    "absolutePath",
    "organizationId",
    "repositoryFingerprint",
  ])("rejects caller-owned or device-private field %s", (forbiddenField) => {
    expect(
      centerAgentCreateProjectToolRpcInputSchema.safeParse({
        [forbiddenField]:
          forbiddenField === "absolutePath"
            ? "/Users/example/private/work"
            : "caller-controlled",
        context,
        executionMode: "interactive",
        name: "OpenMeld",
        operationId: "create-openmeld-repository",
        repositoryUrl: "https://github.com/amplifthq/openmeld",
        speakerMember,
      })
    ).toMatchObject({ success: false });
  });

  it("returns a bounded safe Project projection without local connection data", () => {
    expect(
      centerAgentListProjectsToolResponseSchema.safeParse({
        hasMore: false,
        projects: [
          {
            canArchive: true,
            canManage: true,
            id: "project_1",
            name: "OpenMeld",
            repositoryUrl: "https://github.com/amplifthq/openmeld",
            slug: "openmeld",
          },
        ],
      })
    ).toMatchObject({ success: true });

    expect(
      centerAgentListProjectsToolResponseSchema.safeParse({
        hasMore: false,
        projects: [
          {
            absolutePath: "/Users/example/private/work",
            canArchive: true,
            canManage: true,
            id: "project_1",
            name: "OpenMeld",
            repositoryUrl: "https://github.com/amplifthq/openmeld",
            slug: "openmeld",
          },
        ],
      })
    ).toMatchObject({ success: false });
  });

  it("sets Default Project only through an explicit represented-member profile target", () => {
    expect(
      centerAgentSetAgentProfileDefaultProjectToolRpcInputSchema.safeParse({
        agentProfileId: "profile_1",
        context,
        executionMode: "interactive",
        operationId: "set-codex-main-default-project",
        projectId: "project_1",
        speakerMember,
      })
    ).toMatchObject({ success: true });
  });

  it("requires a short-lived opaque confirmation before Project removal", () => {
    expect(
      centerAgentPrepareRemoveProjectToolResponseSchema.safeParse({
        confirmation: {
          expiresAtMs: 1_800_000_000_000,
          token: "project_remove_confirmation_1",
        },
        project: {
          canArchive: true,
          canManage: true,
          id: "project_1",
          name: "OpenMeld",
          repositoryUrl: "https://github.com/amplifthq/openmeld",
          slug: "openmeld",
        },
        warning:
          "Removing this Project is permanent. Existing Agent Activity remains available under its normal retention.",
      })
    ).toMatchObject({ success: true });
  });

  it("requires a trusted execution mode on every Project tool request", () => {
    expect(
      centerAgentCreateProjectToolRpcInputSchema.safeParse({
        context,
        name: "OpenMeld",
        operationId: "create-openmeld-repository",
        speakerMember,
      })
    ).toMatchObject({ success: false });
  });
});
