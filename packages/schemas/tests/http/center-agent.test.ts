import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  centerAgentActionSchema,
  centerAgentAddMembersToSpaceBodySchema,
  centerAgentAddMembersToSpaceResponseSchema,
  centerAgentConnectAgentProfileToLocalAgentBodySchema,
  centerAgentCreateConfiguredAgentProfileBodySchema,
  centerAgentCreateConfiguredAgentProfileResponseSchema,
  centerAgentDispatchHistoryLatestAttemptSchema,
  centerAgentListComputersBodySchema,
  centerAgentListComputersResponseSchema,
  centerAgentListLocalAgentConnectionCandidatesResponseSchema,
  centerAgentModelConfigurationResponseSchema,
  centerAgentReadConnectorActionOperationResponseSchema,
  centerAgentReadMemberComputersResponseSchema,
  centerAgentReadSpaceContextBodySchema,
  centerAgentReadSpaceContextResponseSchema,
  centerAgentRemoteRuntimeAvailabilityReasonCodeSchema,
  centerAgentUpdateAgentProfileRuntimeSettingsBodySchema,
  deriveCenterAgentDirectMessageSpaceProjection,
  getCenterAgentDesignationResponseSchema,
  isCenterAgentDirectMessageSpaceProjection,
  listCenterAgentAuditJournalQuerySchema,
  slackIdentityLinkConsumeResponseSchema,
  slackIdentityLinkPreviewResponseSchema,
  updateCenterAgentModelBodySchema,
} from "../../src";

describe("Center Agent HTTP schemas", () => {
  it("keeps model reads visible while model writes use optimistic concurrency", () => {
    const configuration = {
      canManage: false,
      choices: [
        {
          displayName: "OpenMeld default",
          effectiveModelDisplayName: "Grok 4.5",
          preference: { kind: "system_default" },
          supportsImageInput: true,
        },
        {
          displayName: "DeepSeek V4 Flash",
          effectiveModelDisplayName: "DeepSeek V4 Flash",
          preference: {
            kind: "selected_model",
            modelId: "deepseek/deepseek-v4-flash",
          },
          supportsImageInput: false,
        },
      ],
      configurationRevision: 4,
      effectiveModel: {
        availability: "available",
        displayName: "Grok 4.5",
        modelId: "x-ai/grok-4.5",
        supportsImageInput: true,
      },
      organizationId: "org_1",
      preference: { kind: "system_default" },
    } as const;

    expect(
      centerAgentModelConfigurationResponseSchema.parse(configuration)
    ).toEqual(configuration);
    expect(
      centerAgentModelConfigurationResponseSchema.parse({
        ...configuration,
        choices: [
          { ...configuration.choices[0], badgeLabel: "New" },
          configuration.choices[1],
        ],
      }).choices[0]?.badgeLabel
    ).toBe("New");
    expect(
      updateCenterAgentModelBodySchema.parse({
        expectedConfigurationRevision: 4,
        preference: {
          kind: "selected_model",
          modelId: "deepseek/deepseek-v4-flash",
        },
      })
    ).toEqual({
      expectedConfigurationRevision: 4,
      preference: {
        kind: "selected_model",
        modelId: "deepseek/deepseek-v4-flash",
      },
    });
    expect(
      updateCenterAgentModelBodySchema.safeParse({
        preference: { kind: "system_default" },
      }).success
    ).toBe(false);
  });

  it("requires a connected computer identity for reconnect and update actions", () => {
    const base = {
      connectedComputerId: "computer_1",
      deviceDisplayName: "Felix MacBook Pro",
      deviceId: "device_1",
      isCurrent: true,
      lastObservedAtMs: 1000,
      reasonCodes: ["service.update_required"],
      status: "needs_attention",
    } as const;

    expect(
      centerAgentListComputersResponseSchema.safeParse({
        computers: [{ ...base, recommendedMode: "update_service" }],
        organizationId: "org_1",
      }).success
    ).toBe(true);
    expect(
      centerAgentListComputersResponseSchema.safeParse({
        computers: [
          {
            ...base,
            connectedComputerId: null,
            recommendedMode: "reconnect",
          },
        ],
        organizationId: "org_1",
      }).success
    ).toBe(false);
  });

  it("keeps computer setup context isolated from the strict candidate RPC", () => {
    expect(
      centerAgentListComputersBodySchema.parse({
        includeDiagnostics: true,
        includeUsageLimits: "true",
        speakerMember: { memberId: "member_1", userId: "user_1" },
      })
    ).toEqual({
      includeDiagnostics: true,
      includeUsageLimits: "true",
      speakerMember: { memberId: "member_1", userId: "user_1" },
    });
    expect(centerAgentListComputersBodySchema.safeParse({}).success).toBe(
      false
    );
    expect(
      centerAgentListLocalAgentConnectionCandidatesResponseSchema.safeParse({
        candidates: [],
        computers: [],
        organizationId: "org_1",
      }).success
    ).toBe(false);
  });

  it("keeps teammate Computer reads on the strict team-safe projection", () => {
    expect(
      centerAgentReadMemberComputersResponseSchema.parse({
        computers: [],
        generatedAt: "2026-08-19T00:00:00.000Z",
        memberUserId: "user_2",
        organizationId: "org_1",
      })
    ).toEqual({
      computers: [],
      generatedAt: "2026-08-19T00:00:00.000Z",
      memberUserId: "user_2",
      organizationId: "org_1",
    });
  });

  it("rejects teammate Computer rows owned by a different member", () => {
    expect(
      centerAgentReadMemberComputersResponseSchema.safeParse({
        computers: [
          {
            computerId: "computer_1",
            deviceDisplayName: "Someone else's MacBook",
            deviceType: "laptop",
            lastSeenAtMs: 1,
            localAgents: [],
            osVersion: "15.6",
            ownerUserId: "user_3",
            platformFamily: "macOS",
            serviceState: "connected",
          },
        ],
        generatedAt: "2026-08-19T00:00:00.000Z",
        memberUserId: "user_2",
        organizationId: "org_1",
      }).success
    ).toBe(false);
  });

  it("keeps connector replay attribution tied to the frozen execution connection", () => {
    const response = {
      operation: {
        actionId: "issues.create",
        connectionName: "github-mira",
        executionConnection: {
          connectionName: "github-mira",
          ownerDisplayName: "Mira",
          ownerUserId: "user-mira",
          scope: "member",
          service: "github",
        },
        operationId: "operation-1",
        service: "github",
        status: "completed",
      },
    };

    expect(
      centerAgentReadConnectorActionOperationResponseSchema.safeParse(response)
        .success
    ).toBe(true);
    expect(
      centerAgentReadConnectorActionOperationResponseSchema.safeParse({
        operation: {
          ...response.operation,
          executionConnection: {
            ...response.operation.executionConnection,
            connectionName: "github-other",
          },
        },
      }).success
    ).toBe(false);

    const legacyStrictConsumerSchema = z.strictObject({
      operation: z
        .strictObject({
          actionId: z.string(),
          connectionName: z.string(),
          operationId: z.string(),
          service: z.string(),
          status: z.string(),
        })
        .nullable(),
    });
    expect(legacyStrictConsumerSchema.safeParse(response).success).toBe(false);
  });

  it("requires exact anchors for progressive Space context reads", () => {
    expect(
      centerAgentReadSpaceContextBodySchema.parse({
        scope: "source",
        sourceSignalId: "signal-1",
        spaceId: "space-1",
      })
    ).toEqual({
      scope: "source",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
    });
    expect(
      centerAgentReadSpaceContextBodySchema.safeParse({
        scope: "thread",
        spaceId: "space-1",
      }).success
    ).toBe(false);
    expect(
      centerAgentReadSpaceContextBodySchema.safeParse({
        afterSignalId: "signal-1",
        scope: "history",
        spaceId: "space-1",
      }).success
    ).toBe(false);
  });

  it("accepts bounded progressive Space context without requiring a broad bootstrap", () => {
    expect(
      centerAgentReadSpaceContextResponseSchema.parse({
        context: {
          scope: "delta",
          afterSignalId: "signal-1",
          signals: [],
          truncated: false,
        },
        organizationId: "org-1",
        spaceId: "space-1",
      })
    ).toEqual({
      context: {
        scope: "delta",
        afterSignalId: "signal-1",
        signals: [],
        truncated: false,
      },
      organizationId: "org-1",
      spaceId: "space-1",
    });
  });

  it("returns an exact thread reference with source context when one exists", () => {
    expect(
      centerAgentReadSpaceContextResponseSchema.parse({
        context: {
          scope: "source",
          signals: [],
          sourceSignalId: "signal-1",
          threadContext: {
            rootSignalId: "signal-root",
            threadId: "thr_11111111-1111-4111-8111-111111111111",
          },
          truncated: false,
        },
        organizationId: "org-1",
        spaceId: "space-1",
      })
    ).toMatchObject({
      context: {
        scope: "source",
        threadContext: {
          rootSignalId: "signal-root",
          threadId: "thr_11111111-1111-4111-8111-111111111111",
        },
      },
    });
  });

  it("keeps member addition strict and reports each rejected Organization member", () => {
    expect(
      centerAgentAddMembersToSpaceBodySchema.parse({
        memberUserIds: ["user-1", "user-external"],
        spaceId: "space-1",
        speakerMember: { memberId: "member-1", userId: "user-1" },
      })
    ).toEqual({
      memberUserIds: ["user-1", "user-external"],
      spaceId: "space-1",
      speakerMember: { memberId: "member-1", userId: "user-1" },
    });
    expect(
      centerAgentAddMembersToSpaceBodySchema.safeParse({
        memberUserIds: [],
        spaceId: "space-1",
        speakerMember: { memberId: "member-1", userId: "user-1" },
      }).success
    ).toBe(false);
    expect(
      centerAgentAddMembersToSpaceResponseSchema.safeParse({
        attribution: {
          actorProfileId: "agt_22222222-2222-4222-8222-222222222222",
          onBehalfOf: {
            displayName: "Mira",
            profileId: "11111111-1111-4111-8111-111111111111",
            userId: "user-1",
          },
        },
        membership: {
          addedMemberIds: ["33333333-3333-4333-8333-333333333333"],
          alreadyMemberIds: [],
          items: [],
        },
        organizationId: "org-1",
        resource: { id: "space-1", type: "space" },
        results: [
          {
            memberUserId: "user-2",
            profileId: "33333333-3333-4333-8333-333333333333",
            status: "added",
          },
          {
            code: "not_organization_member",
            memberUserId: "user-external",
            message:
              "This user is not an active member of the current Organization.",
            status: "rejected",
          },
        ],
        spaceId: "space-1",
      }).success
    ).toBe(true);
  });

  it("versions the new audit action behind the v3 action set", () => {
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v3" })
    ).toEqual({ actionSet: "v3" });
  });

  it("versions member Computer reads behind the v19 action set", () => {
    expect(centerAgentActionSchema.parse("read_member_computers")).toBe(
      "read_member_computers"
    );
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v19" })
    ).toEqual({ actionSet: "v19" });
  });

  it("accepts the Center Agent Project audit actions", () => {
    for (const action of [
      "read_projects",
      "create_project",
      "update_project",
      "set_agent_profile_default_project",
      "prepare_remove_project",
      "remove_project",
    ]) {
      expect(centerAgentActionSchema.safeParse(action)).toMatchObject({
        success: true,
      });
    }
    expect(
      listCenterAgentAuditJournalQuerySchema.safeParse({ actionSet: "v8" })
    ).toMatchObject({ success: true });
  });

  it("rejects dispatch error summaries above the shared 512-character boundary", () => {
    const attempt = {
      attemptId: "attempt-1",
      attemptNo: 1,
      createdAt: "2026-07-11T00:00:00.000Z",
      errorCode: "runtime.turn.failed",
      errorMessage: "x".repeat(513),
      finishedAt: "2026-07-11T00:01:00.000Z",
      startedAt: "2026-07-11T00:00:01.000Z",
      status: "failed_terminal",
    };

    expect(
      centerAgentDispatchHistoryLatestAttemptSchema.safeParse(attempt).success
    ).toBe(false);
    expect(
      centerAgentDispatchHistoryLatestAttemptSchema.safeParse({
        ...attempt,
        errorMessage: "x".repeat(512),
      }).success
    ).toBe(true);
  });

  it("accepts configured-profile responses with and without the optional workspace echo", () => {
    const response = {
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      canReply: true,
      organizationId: "org-a",
      spaceId: "space-a",
      status: "completed",
      steps: [
        { name: "create_agent_profile", status: "completed" },
        { name: "enable_agent_profile", status: "completed" },
        {
          name: "select_local_agent_connection_candidate",
          status: "completed",
        },
        {
          name: "connect_agent_profile_to_local_agent",
          status: "completed",
        },
        { name: "add_agent_profile_to_space", status: "completed" },
        { name: "check_agent_profile_readiness", status: "completed" },
      ],
    };

    expect(
      centerAgentCreateConfiguredAgentProfileResponseSchema.safeParse(response)
        .success
    ).toBe(true);
    expect(
      centerAgentCreateConfiguredAgentProfileResponseSchema.safeParse({
        ...response,
        steps: [
          ...response.steps.slice(0, 4),
          { name: "update_agent_profile_workspace", status: "completed" },
          ...response.steps.slice(4),
        ],
        workspace: {
          agentProfileId: response.agentProfileId,
          status: "updated",
          workspaceMode: "custom",
          workspacePath: "/Users/felix/work/openmeld",
        },
      }).success
    ).toBe(true);
  });

  it("accepts Codex Collaboration Mode across Center Agent runtime writes", () => {
    expect(
      centerAgentConnectAgentProfileToLocalAgentBodySchema.safeParse({
        agentControllerCollaborationMode: "codex:plan",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        candidateId: "candidate-1",
      }).success
    ).toBe(true);
    expect(
      centerAgentUpdateAgentProfileRuntimeSettingsBodySchema.safeParse({
        agentControllerCollaborationMode: "codex:plan",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      }).success
    ).toBe(true);
    expect(
      centerAgentCreateConfiguredAgentProfileBodySchema.safeParse({
        agentControllerCollaborationMode: "codex:plan",
        candidateId: "candidate-1",
        profileName: "Planner",
        spaceId: "space-1",
      }).success
    ).toBe(true);
  });

  it("keeps the designation read projection optional for existing clients", () => {
    const parsed = getCenterAgentDesignationResponseSchema.safeParse({
      organizationId: "org-a",
      designation: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("defaults Slack identity-link response additions for older Core producers", () => {
    expect(
      slackIdentityLinkPreviewResponseSchema.parse({
        expiresAt: "2026-07-31T12:00:00.000Z",
        organizationId: "org-a",
        organizationName: "Amplift",
        slackDisplayName: "Mira",
        slackTeamId: "T123",
        slackUserId: "U123",
        slackWorkspaceLabel: "Amplift",
        openMeldAccountEmail: "mira@example.com",
      })
    ).toMatchObject({ alreadyMember: true });

    expect(
      slackIdentityLinkConsumeResponseSchema.parse({
        linked: true,
        organizationId: "org-a",
        organizationName: "Amplift",
        slackDisplayName: "Mira",
        slackTeamId: "T123",
        slackUserId: "U123",
        openMeldUserId: "user-a",
      })
    ).toMatchObject({
      continuationRetryable: false,
      continued: false,
      joinedOrganization: false,
    });
  });

  it("accepts the Remote Agent runtime availability projection with stable reason codes", () => {
    const parsed = getCenterAgentDesignationResponseSchema.safeParse({
      organizationId: "org-a",
      designation: null,
      remoteRuntimeAvailability: {
        selectable: false,
        reasonCode: "organization_blocked",
      },
    });

    expect(parsed.success).toBe(true);
    expect(
      centerAgentRemoteRuntimeAvailabilityReasonCodeSchema.safeParse(
        "remote_agent.organization_blocked"
      ).success
    ).toBe(false);
  });

  it("derives Center Agent DM only from DM origin and the designated profile", () => {
    expect(
      deriveCenterAgentDirectMessageSpaceProjection({
        centerAgentProfileId: "agt-center",
        directMessagePairKey: "human-1:agt-center",
        organizationId: "org-a",
        spaceId: "space-ca-dm",
        spacePurpose: "openmeld_dm_space",
      })
    ).toEqual({
      centerAgentProfileId: "agt-center",
      isCenterAgentDirectMessageSpace: true,
      kind: "center_agent_direct_message_space",
      memberProfileId: "human-1",
      organizationId: "org-a",
      spaceId: "space-ca-dm",
    });

    expect(
      isCenterAgentDirectMessageSpaceProjection({
        centerAgentProfileId: "agt-center",
        directMessagePairKey: "human-1:agt-helper",
        spacePurpose: "openmeld_dm_space",
      })
    ).toBe(false);
    expect(
      isCenterAgentDirectMessageSpaceProjection({
        centerAgentProfileId: "agt-center",
        directMessagePairKey: "human-1:agt-center",
        spacePurpose: "team_space",
      })
    ).toBe(false);
  });
});
