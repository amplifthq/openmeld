import { describe, expect, it } from "vitest";
import {
  CENTER_AGENT_ROUTINE_ERROR_CODES,
  centerAgentActionSchema,
  centerAgentCreateRoutineToolRpcInputSchema,
  centerAgentDeleteRoutineToolRpcInputSchema,
  centerAgentListRoutinesToolRpcInputSchema,
  centerAgentPauseRoutineToolRpcInputSchema,
  centerAgentResumeRoutineToolRpcInputSchema,
  centerAgentRoutineLastRunSummarySchema,
  centerAgentRoutineManagementSchema,
  centerAgentRoutineManagementV1Schema,
  centerAgentRoutineRunSchema,
  centerAgentRoutineSchema,
  centerAgentRoutineTargetSpaceSchema,
  centerAgentUpdateRoutineToolRpcInputSchema,
  createCenterAgentRoutineBodySchema,
  createCenterAgentRoutineRpcInputSchema,
  deleteCenterAgentRoutineBodySchema,
  deleteCenterAgentRoutineRpcInputSchema,
  gatewayErrorCodeSchema,
  listCenterAgentRoutineRunsQuerySchema,
  listCenterAgentRoutineRunsRpcInputSchema,
  listCenterAgentRoutinesRpcInputSchema,
  listCenterAgentRoutineTargetSpacesQuerySchema,
  listCenterAgentRoutineTargetSpacesResponseSchema,
  listCenterAgentRoutineTargetSpacesRpcInputSchema,
  pauseCenterAgentRoutineBodySchema,
  pauseCenterAgentRoutineRpcInputSchema,
  resumeCenterAgentRoutineBodySchema,
  resumeCenterAgentRoutineRpcInputSchema,
  updateCenterAgentRoutineBodySchema,
  updateCenterAgentRoutineRpcInputSchema,
} from "../../src";

const VALID_CREATE_BODY = {
  cronExpression: "0 9 * * *",
  instructions: "Review new Feedback Inbox issues and summarize next actions.",
  name: "Daily feedback review",
  targetSpaceId: "space-feedback-triage",
  timezone: "America/Los_Angeles",
};
const VALID_RPC_CONTEXT = {
  activeOrganizationId: "org-1",
  actorContext: {
    callerPrincipalId: "user-1",
    ownerUserId: "user-1",
    profileKind: "human" as const,
    requestId: "request-routine-contract",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  },
};
const VALID_CENTER_AGENT_RPC_CONTEXT = {
  ...VALID_RPC_CONTEXT,
  actorContext: {
    ...VALID_RPC_CONTEXT.actorContext,
    agentControllerRef: "hosted:center-agent",
    profileKind: "agent" as const,
    openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
  },
};
const VALID_ROUTINE_TOOL_SPEAKER = {
  memberId: "member-1",
  userId: "user-1",
};
describe("Center Agent Routine HTTP contracts", () => {
  it("versions Routine management provenance without widening older contracts", () => {
    expect(
      listCenterAgentRoutinesRpcInputSchema.safeParse({
        contract: "management-v1",
      })
    ).toMatchObject({ success: true });
    expect(
      listCenterAgentRoutinesRpcInputSchema.safeParse({
        contract: "management-v2",
      })
    ).toMatchObject({ success: true });
    const managementV1Routine = {
      canManage: true,
      capabilityState: {
        approvedKnowledge: true,
        canRepair: true,
        externalActionPolicy: "read_only",
        slackChannelReport: false,
      },
      createdAtMs: 1_752_200_000_000,
      createdByUserId: "user-1",
      cronExpression: "0 9 * * *",
      destinationKind: "space",
      id: "routine-1",
      instructions: "Review new Feedback Inbox issues.",
      lastRun: null,
      name: "Daily feedback review",
      nextDueAt: 1_752_400_000_000,
      organizationId: "org-1",
      runAtMs: null,
      scheduleKind: "cron",
      slackChannelId: null,
      slackConversationId: null,
      slackTeamId: null,
      slackThreadLabel: null,
      slackThreadTs: null,
      status: "enabled",
      targetSpaceId: "space-1",
      timezone: "America/Los_Angeles",
      updatedAtMs: 1_752_200_000_000,
      updatedByUserId: "user-1",
    };
    expect(
      centerAgentRoutineManagementV1Schema.safeParse(managementV1Routine)
    ).toMatchObject({ success: true });
    expect(
      centerAgentRoutineManagementSchema.safeParse({
        ...managementV1Routine,
        creationAttribution: {
          displayName: "Mira Chen",
          interactionSource: { client: "codex", kind: "local_agent" },
        },
      })
    ).toMatchObject({ success: true });
    expect(
      centerAgentRoutineManagementSchema.safeParse({
        ...managementV1Routine,
        creationAttribution: {
          displayName: "Mira Chen",
          interactionSource: {
            client: "codex",
            kind: "local_agent",
            sessionId: "private-session-locator",
          },
        },
      })
    ).toMatchObject({ success: false });
    expect(
      centerAgentRoutineManagementV1Schema.safeParse({
        ...managementV1Routine,
        creationAttribution: { displayName: "Mira Chen" },
      })
    ).toMatchObject({ success: false });
    expect(
      centerAgentRoutineManagementSchema.safeParse(managementV1Routine)
    ).toMatchObject({ success: false });
    expect(
      centerAgentRoutineSchema.safeParse(managementV1Routine)
    ).toMatchObject({ success: false });
  });

  it("keeps the external action policy optional and accepts an explicit read-only policy", () => {
    expect(
      createCenterAgentRoutineBodySchema.parse(VALID_CREATE_BODY)
    ).not.toHaveProperty("externalActionPolicy");
    expect(
      createCenterAgentRoutineBodySchema.parse({
        ...VALID_CREATE_BODY,
        externalActionPolicy: "read_only",
      })
    ).toMatchObject({
      externalActionPolicy: "read_only",
    });
    expect(
      updateCenterAgentRoutineBodySchema.safeParse({
        externalActionPolicy: "read_only",
      })
    ).toMatchObject({ success: true });
  });

  it("accepts a narrow Slack report capability without enabling general external writes", () => {
    expect(
      createCenterAgentRoutineBodySchema.parse({
        ...VALID_CREATE_BODY,
        authorizedActions: [
          "organization_documents.save_approved_knowledge",
          "slack.publish_channel_report",
        ],
        externalActionPolicy: "read_only",
      }).authorizedActions
    ).toEqual([
      "organization_documents.save_approved_knowledge",
      "slack.publish_channel_report",
    ]);
  });

  it("accepts a one-time Routine targeting the current Slack thread", () => {
    expect(
      createCenterAgentRoutineBodySchema.safeParse({
        cronExpression: null,
        destinationKind: "slack_thread",
        instructions: "Post a reminder in this Slack thread.",
        name: "Tomorrow morning reminder",
        runAtMs: 1_783_939_200_000,
        scheduleKind: "once",
        slackChannelId: "C123",
        slackConversationId: "slack:T123:C123:1710000000.000100",
        slackTeamId: "T123",
        slackThreadLabel: "#launch thread",
        slackThreadTs: "1710000000.000100",
        targetSpaceId: null,
        timezone: null,
      })
    ).toMatchObject({ success: true });
  });

  it("rejects incomplete one-time schedules and Slack destinations", () => {
    expect(
      createCenterAgentRoutineBodySchema.safeParse({
        ...VALID_CREATE_BODY,
        cronExpression: null,
        runAtMs: null,
        scheduleKind: "once",
        timezone: null,
      })
    ).toMatchObject({ success: false });
    expect(
      createCenterAgentRoutineBodySchema.safeParse({
        ...VALID_CREATE_BODY,
        destinationKind: "slack_thread",
        slackChannelId: "C123",
        slackTeamId: "T123",
        targetSpaceId: null,
      })
    ).toMatchObject({ success: false });
  });

  it("requires an explicit target Space and timezone on create", () => {
    expect(
      createCenterAgentRoutineBodySchema.safeParse(VALID_CREATE_BODY)
    ).toMatchObject({ success: true });
    expect(
      createCenterAgentRoutineBodySchema.safeParse({
        ...VALID_CREATE_BODY,
        timezone: undefined,
      })
    ).toMatchObject({ success: false });
    expect(
      createCenterAgentRoutineBodySchema.safeParse({
        ...VALID_CREATE_BODY,
        targetSpaceId: undefined,
      })
    ).toMatchObject({ success: false });
  });

  it("rejects unknown create and update fields", () => {
    expect(
      createCenterAgentRoutineBodySchema.safeParse({
        ...VALID_CREATE_BODY,
        status: "paused",
      })
    ).toMatchObject({ success: false });
    expect(
      updateCenterAgentRoutineBodySchema.safeParse({
        name: "Updated routine",
        unexpected: true,
      })
    ).toMatchObject({ success: false });
  });

  it("requires at least one supported update field", () => {
    expect(updateCenterAgentRoutineBodySchema.safeParse({})).toMatchObject({
      success: false,
    });
    expect(
      updateCenterAgentRoutineBodySchema.safeParse({
        cronExpression: "30 9 * * 1-5",
        timezone: "America/New_York",
      })
    ).toMatchObject({ success: true });
  });

  it.each([
    pauseCenterAgentRoutineBodySchema,
    resumeCenterAgentRoutineBodySchema,
    deleteCenterAgentRoutineBodySchema,
  ])("keeps empty mutation bodies strict", (schema) => {
    expect(schema.safeParse({})).toMatchObject({ success: true });
    expect(schema.safeParse({ force: true })).toMatchObject({ success: false });
  });

  it("parses bounded runs pagination explicitly", () => {
    expect(
      listCenterAgentRoutineRunsQuerySchema.safeParse({
        beforeScheduledFor: "1783852800000",
        limit: "25",
      })
    ).toEqual({
      success: true,
      data: {
        beforeScheduledFor: 1_783_852_800_000,
        limit: 25,
      },
    });
    expect(
      listCenterAgentRoutineRunsQuerySchema.safeParse({ limit: "0" })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineRunsQuerySchema.safeParse({
        beforeScheduledFor: String(Number.MAX_SAFE_INTEGER + 1),
      })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineRunsQuerySchema.safeParse({
        beforeScheduledFor: String(Number.MIN_SAFE_INTEGER - 1),
      })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineRunsQuerySchema.safeParse({ unknown: "1" })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineRunsQuerySchema.safeParse({
        beforeScheduledFor: "-300000",
      })
    ).toEqual({
      success: true,
      data: { beforeScheduledFor: -300_000 },
    });
    for (const beforeScheduledFor of ["-1.5", "+1", "1e3", "--1", "1x"]) {
      expect(
        listCenterAgentRoutineRunsQuerySchema.safeParse({ beforeScheduledFor })
      ).toMatchObject({ success: false });
    }
  });

  it("keeps every Routine RPC input strict with number-based run pagination", () => {
    const inputs = [
      [listCenterAgentRoutinesRpcInputSchema, { context: VALID_RPC_CONTEXT }],
      [
        createCenterAgentRoutineRpcInputSchema,
        { context: VALID_RPC_CONTEXT, ...VALID_CREATE_BODY },
      ],
      [
        updateCenterAgentRoutineRpcInputSchema,
        {
          context: VALID_RPC_CONTEXT,
          name: "Updated routine",
          routineId: "routine-1",
        },
      ],
      [
        pauseCenterAgentRoutineRpcInputSchema,
        { context: VALID_RPC_CONTEXT, routineId: "routine-1" },
      ],
      [
        resumeCenterAgentRoutineRpcInputSchema,
        { context: VALID_RPC_CONTEXT, routineId: "routine-1" },
      ],
      [
        deleteCenterAgentRoutineRpcInputSchema,
        { context: VALID_RPC_CONTEXT, routineId: "routine-1" },
      ],
      [
        listCenterAgentRoutineRunsRpcInputSchema,
        {
          beforeScheduledFor: 1_783_852_800_000,
          context: VALID_RPC_CONTEXT,
          limit: 25,
          routineId: "routine-1",
        },
      ],
    ] as const;

    for (const [schema, input] of inputs) {
      expect(schema.safeParse(input)).toMatchObject({ success: true });
      expect(schema.safeParse({ ...input, unknown: true })).toMatchObject({
        success: false,
      });
    }
    expect(
      createCenterAgentRoutineRpcInputSchema.safeParse({
        context: VALID_RPC_CONTEXT,
        ...VALID_CREATE_BODY,
        targetSpaceId: null,
      })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineRunsRpcInputSchema.safeParse({
        context: VALID_RPC_CONTEXT,
        limit: "25",
        routineId: "routine-1",
      })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineRunsRpcInputSchema.safeParse({
        beforeScheduledFor: -300_000,
        context: VALID_RPC_CONTEXT,
        routineId: "routine-1",
      })
    ).toMatchObject({ success: true });
    expect(
      listCenterAgentRoutineRunsRpcInputSchema.safeParse({
        beforeScheduledFor: Number.MAX_SAFE_INTEGER + 1,
        context: VALID_RPC_CONTEXT,
        routineId: "routine-1",
      })
    ).toMatchObject({ success: false });
  });

  it("keeps the six member-attributed Center Agent tool RPC inputs strict", () => {
    const attributedContext = {
      context: VALID_CENTER_AGENT_RPC_CONTEXT,
      speakerMember: VALID_ROUTINE_TOOL_SPEAKER,
    };
    const inputs = [
      [centerAgentListRoutinesToolRpcInputSchema, attributedContext],
      [
        centerAgentCreateRoutineToolRpcInputSchema,
        { ...attributedContext, ...VALID_CREATE_BODY },
      ],
      [
        centerAgentUpdateRoutineToolRpcInputSchema,
        {
          ...attributedContext,
          name: "Updated Routine",
          routineId: "routine-1",
        },
      ],
      [
        centerAgentDeleteRoutineToolRpcInputSchema,
        { ...attributedContext, routineId: "routine-1" },
      ],
      [
        centerAgentPauseRoutineToolRpcInputSchema,
        { ...attributedContext, routineId: "routine-1" },
      ],
      [
        centerAgentResumeRoutineToolRpcInputSchema,
        { ...attributedContext, routineId: "routine-1" },
      ],
    ] as const;

    for (const [schema, input] of inputs) {
      expect(schema.safeParse(input)).toMatchObject({ success: true });
      expect(
        schema.safeParse({ ...input, onBehalfOf: VALID_ROUTINE_TOOL_SPEAKER })
      ).toMatchObject({ success: false });
      expect(schema.safeParse({ ...input, unknown: true })).toMatchObject({
        success: false,
      });
      expect(
        schema.safeParse({
          ...input,
          speakerMember: { ...VALID_ROUTINE_TOOL_SPEAKER, role: "owner" },
        })
      ).toMatchObject({ success: false });
    }

    expect(
      centerAgentUpdateRoutineToolRpcInputSchema.safeParse({
        ...attributedContext,
        routineId: "routine-1",
      })
    ).toMatchObject({ success: false });
    expect(
      centerAgentCreateRoutineToolRpcInputSchema.safeParse({
        ...attributedContext,
        ...VALID_CREATE_BODY,
        targetSpaceId: null,
      })
    ).toMatchObject({ success: false });
  });

  it("keeps Routine and Run response records strict", () => {
    const routine = {
      canManage: true,
      createdAtMs: 1_783_852_800_000,
      createdByUserId: "user-1",
      cronExpression: "0 9 * * *",
      id: "routine-1",
      instructions: "Review feedback.",
      lastRun: null,
      name: "Daily feedback review",
      nextDueAt: 1_783_939_200_000,
      organizationId: "org-1",
      scheduleKind: "cron",
      status: "enabled",
      targetSpaceId: "space-1",
      timezone: "America/Los_Angeles",
      updatedAtMs: 1_783_852_800_000,
      updatedByUserId: "user-1",
    };
    expect(centerAgentRoutineSchema.safeParse(routine)).toMatchObject({
      success: true,
    });
    for (const invalidRoutine of [
      { ...routine, createdAtMs: -1 },
      { ...routine, nextDueAt: -1 },
      { ...routine, updatedAtMs: -1 },
    ]) {
      expect(centerAgentRoutineSchema.safeParse(invalidRoutine)).toMatchObject({
        success: false,
      });
    }
    const lastRun = {
      failureCode: "routine.execution_failed",
      failureDetail: "The hosted turn failed before publication.",
      finishedAtMs: 1_783_939_201_000,
      id: "run-1",
      publishedSignalId: "signal-1",
      scheduledFor: 1_783_939_200_000,
      startedAtMs: 1_783_939_200_100,
      status: "failed",
    };
    expect(centerAgentRoutineLastRunSummarySchema.safeParse(lastRun)).toEqual({
      data: lastRun,
      success: true,
    });
    expect(
      centerAgentRoutineSchema.safeParse({ ...routine, lastRun })
    ).toMatchObject({ success: true });
    expect(
      centerAgentRoutineLastRunSummarySchema.safeParse({
        ...lastRun,
        nativeDeliveryId: "native-delivery-1",
      })
    ).toMatchObject({ success: false });
    const { lastRun: _lastRun, ...routineWithoutLastRun } = routine;
    expect(
      centerAgentRoutineSchema.safeParse(routineWithoutLastRun)
    ).toMatchObject({ success: false });
    expect(
      centerAgentRoutineSchema.safeParse({ ...routine, extra: true })
    ).toMatchObject({ success: false });

    const run = {
      failureCode: null,
      failureDetail: null,
      finishedAtMs: null,
      id: "run-1",
      nativeDeliveryId: null,
      organizationId: "org-1",
      publishedSignalId: null,
      routineId: "routine-1",
      scheduledFor: 1_783_939_200_000,
      startedAtMs: 1_783_939_200_100,
      status: "claimed",
    };
    expect(centerAgentRoutineRunSchema.safeParse(run)).toMatchObject({
      success: true,
    });
    expect(
      centerAgentRoutineRunSchema.safeParse({ ...run, extra: true })
    ).toMatchObject({ success: false });
  });

  it("allows negative Run schedule evidence only for invalid-schedule quarantine", () => {
    const quarantineRun = {
      failureCode: "routine.schedule_invalid",
      failureDetail: "The stored schedule is outside the supported horizon.",
      finishedAtMs: 1_783_939_201_000,
      id: "run-quarantine",
      nativeDeliveryId: null,
      organizationId: "org-1",
      publishedSignalId: null,
      routineId: "routine-1",
      scheduledFor: -300_000,
      startedAtMs: 1_783_939_200_100,
      status: "skipped",
    } as const;
    const {
      nativeDeliveryId: _nativeDeliveryId,
      organizationId: _organizationId,
      routineId: _routineId,
      ...lastRun
    } = quarantineRun;

    expect(centerAgentRoutineRunSchema.safeParse(quarantineRun)).toMatchObject({
      success: true,
    });
    expect(
      centerAgentRoutineLastRunSummarySchema.safeParse(lastRun)
    ).toMatchObject({ success: true });
    for (const invalidLastRun of [
      { ...lastRun, status: "failed" },
      { ...lastRun, failureCode: "routine.occurrences_overdue" },
      { ...lastRun, failureCode: null },
      { ...lastRun, startedAtMs: -1 },
      { ...lastRun, finishedAtMs: -1 },
    ]) {
      expect(
        centerAgentRoutineLastRunSummarySchema.safeParse(invalidLastRun)
      ).toMatchObject({ success: false });
    }
    for (const invalid of [
      { ...quarantineRun, status: "failed" },
      { ...quarantineRun, failureCode: "routine.occurrences_overdue" },
      { ...quarantineRun, failureCode: null },
      { ...quarantineRun, startedAtMs: -1 },
      { ...quarantineRun, finishedAtMs: -1 },
    ]) {
      expect(centerAgentRoutineRunSchema.safeParse(invalid)).toMatchObject({
        success: false,
      });
    }
  });

  it("keeps Routine target Space contracts strict", () => {
    const spaces = [
      {
        kind: "center_agent_dm",
        name: "Mira and Center Agent",
        spaceId: "space-center-agent-dm",
      },
      {
        kind: "space",
        name: "Feedback triage",
        spaceId: "space-feedback-triage",
      },
    ];
    const response = { organizationId: "org-1", spaces };

    expect(
      listCenterAgentRoutineTargetSpacesResponseSchema.safeParse(response)
    ).toEqual({ data: response, success: true });
    expect(
      centerAgentRoutineTargetSpaceSchema.safeParse({
        ...spaces[0],
        visibility: "private",
      })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineTargetSpacesResponseSchema.safeParse({
        ...response,
        generatedAt: "2026-07-12T00:00:00.000Z",
      })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineTargetSpacesQuerySchema.safeParse({ unknown: "1" })
    ).toMatchObject({ success: false });
    expect(
      listCenterAgentRoutineTargetSpacesRpcInputSchema.safeParse({
        context: VALID_RPC_CONTEXT,
      })
    ).toMatchObject({ success: true });
    expect(
      listCenterAgentRoutineTargetSpacesRpcInputSchema.safeParse({
        context: VALID_RPC_CONTEXT,
        unknown: true,
      })
    ).toMatchObject({ success: false });
  });

  it("keeps every Routine failure code on the shared Gateway error surface", () => {
    for (const code of CENTER_AGENT_ROUTINE_ERROR_CODES) {
      expect(gatewayErrorCodeSchema.safeParse(code)).toMatchObject({
        success: true,
      });
    }
  });

  it("shares Routine actions through the explicit Audit Log v17 contract", () => {
    expect(centerAgentActionSchema.safeParse("create_routine")).toMatchObject({
      success: true,
    });
  });
});
