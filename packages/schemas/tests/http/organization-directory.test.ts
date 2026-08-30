import { describe, expect, it } from "vitest";
import {
  centerAgentListOrganizationMembersResponseSchema,
  centerAgentListOrganizationMembersToolRpcInputSchema,
  organizationDirectoryAgentProfileOperationalContextSchema,
} from "../../src/schemas/http/organization-directory";

const context = {
  activeOrganizationId: "organization-1",
  actorContext: {
    agentControllerRef: "hosted:center-agent",
    callerPrincipalId: "user-1",
    ownerUserId: "user-1",
    profileKind: "agent" as const,
    requestId: "request-members",
    openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
  },
};

describe("Center Agent Organization member list contracts", () => {
  it("keeps the RPC input strict and never admits a model-selected Organization", () => {
    expect(
      centerAgentListOrganizationMembersToolRpcInputSchema.parse({
        context,
        limit: 20,
      })
    ).toEqual({ context, limit: 20 });
    expect(
      centerAgentListOrganizationMembersToolRpcInputSchema.safeParse({
        context,
        organizationId: "organization-2",
      }).success
    ).toBe(false);
  });

  it("returns only the bounded member projection without Agent Profiles", () => {
    const response = centerAgentListOrganizationMembersResponseSchema.parse({
      generatedAt: "2026-08-27T08:00:00.000Z",
      members: [
        {
          humanProfile: null,
          joinedAt: "2026-08-01T08:00:00.000Z",
          memberId: "member-1",
          organizationId: "organization-1",
          role: "member",
          user: {
            email: "ashley@example.com",
            id: "user-1",
            image: null,
            name: "Ashley",
          },
          userId: "user-1",
        },
      ],
      nextCursor: null,
      organizationId: "organization-1",
      totalMembers: 1,
    });

    expect(response.totalMembers).toBe(1);
    expect(response).not.toHaveProperty("agentProfiles");
  });
});

describe("Organization directory Agent Profile Operational Context", () => {
  it("keeps the public workload summary stable while owner locations remain optional", () => {
    expect(
      organizationDirectoryAgentProfileOperationalContextSchema.parse({
        status: "working",
        waitingCount: 2,
      })
    ).toEqual({ status: "working", waitingCount: 2 });

    expect(
      organizationDirectoryAgentProfileOperationalContextSchema.parse({
        currentWorkLocation: {
          spaceId: "space-current",
          spaceName: "Launch planning",
        },
        queuedWorkLocations: [
          { spaceId: "space-next", spaceName: "Customer follow-up" },
        ],
        status: "working",
        waitingCount: 1,
      })
    ).toMatchObject({
      currentWorkLocation: { spaceName: "Launch planning" },
      queuedWorkLocations: [{ spaceName: "Customer follow-up" }],
      status: "working",
      waitingCount: 1,
    });
  });

  it("accepts paused workload without exposing owner-action or task details", () => {
    expect(
      organizationDirectoryAgentProfileOperationalContextSchema.parse({
        status: "paused",
        waitingCount: 2,
      })
    ).toEqual({ status: "paused", waitingCount: 2 });

    expect(
      organizationDirectoryAgentProfileOperationalContextSchema.parse({
        currentWorkLocation: {
          spaceId: "space-current",
          spaceName: "Launch planning",
        },
        queuedWorkLocations: [
          { spaceId: "space-next", spaceName: "Customer follow-up" },
        ],
        status: "paused",
        waitingCount: 1,
      })
    ).toMatchObject({
      currentWorkLocation: { spaceName: "Launch planning" },
      queuedWorkLocations: [{ spaceName: "Customer follow-up" }],
      status: "paused",
      waitingCount: 1,
    });

    for (const privateField of ["gateReason", "taskIds", "sourceData"]) {
      expect(
        organizationDirectoryAgentProfileOperationalContextSchema.safeParse({
          [privateField]: "private",
          status: "paused",
          waitingCount: 0,
        }).success
      ).toBe(false);
    }
  });

  it("rejects impossible idle and checking queue counts", () => {
    expect(
      organizationDirectoryAgentProfileOperationalContextSchema.safeParse({
        status: "idle",
        waitingCount: 1,
      }).success
    ).toBe(false);
    expect(
      organizationDirectoryAgentProfileOperationalContextSchema.safeParse({
        status: "checking",
        waitingCount: 0,
      }).success
    ).toBe(false);
  });
});
