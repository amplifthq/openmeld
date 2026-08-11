import { describe, expect, it, vi } from "vitest";
import {
  buildRoutinePath,
  buildRoutineRunsPath,
  buildRoutinesPath,
  buildRoutineTargetSpacesPath,
  createOpenMeldApiClient,
  createRoutinesApi,
  type OpenMeldApiClientTransport,
} from "../src";

const ROUTINE_ID = "routine/with spaces";
const REQUEST_CONTEXT = {
  activeOrganizationId: "org-1",
  actorContext: {
    profileKind: "human" as const,
    requestId: "req-routines-api",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  },
};
const LAST_RUN = {
  failureCode: "routine.execution_failed",
  failureDetail: "The hosted turn failed before publication.",
  finishedAtMs: 1_700_003_660_000,
  id: "run-1",
  publishedSignalId: "signal-1",
  scheduledFor: 1_700_003_600_000,
  startedAtMs: 1_700_003_601_000,
  status: "failed",
} as const;
const ROUTINE = {
  canManage: true,
  createdAtMs: 1_700_000_000_000,
  createdByUserId: "owner-1",
  cronExpression: "0 9 * * *",
  destinationKind: "space",
  id: ROUTINE_ID,
  instructions: "Review new Feedback Inbox issues.",
  lastRun: LAST_RUN,
  name: "Daily feedback review",
  nextDueAt: 1_700_003_600_000,
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
  updatedAtMs: 1_700_000_000_000,
  updatedByUserId: "owner-1",
} as const;
const ROUTINE_TARGET_SPACES = {
  organizationId: "org-1",
  spaces: [
    {
      kind: "center_agent_dm" as const,
      name: "Mira and Center Agent",
      spaceId: "space-center-agent-dm",
    },
    {
      kind: "space" as const,
      name: "Feedback triage",
      spaceId: "space-feedback-triage",
    },
  ],
};
const AUTHORIZED_ACTIONS = [
  "organization_documents.save_approved_knowledge",
] as const;

describe("api-client Routines API", () => {
  it("builds encoded Routine routes", () => {
    expect(buildRoutinesPath()).toBe("/v1/organizations/current/routines");
    expect(buildRoutineTargetSpacesPath()).toBe(
      "/v1/organizations/current/routine-target-spaces"
    );
    expect(buildRoutinePath(ROUTINE_ID)).toBe(
      "/v1/organizations/current/routines/routine%2Fwith%20spaces"
    );
    expect(
      buildRoutineRunsPath(ROUTINE_ID, {
        beforeScheduledFor: 1_700_000_000_000,
        limit: 10,
      })
    ).toBe(
      "/v1/organizations/current/routines/routine%2Fwith%20spaces/runs?beforeScheduledFor=1700000000000&limit=10"
    );
    expect(
      buildRoutineRunsPath(ROUTINE_ID, { beforeScheduledFor: -300_000 })
    ).toBe(
      "/v1/organizations/current/routines/routine%2Fwith%20spaces/runs?beforeScheduledFor=-300000"
    );
  });

  it("accepts exact pre-epoch quarantine evidence and a signed cursor", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(async () =>
      jsonResponse({
        organizationId: "org-1",
        routineId: ROUTINE_ID,
        runs: [
          {
            failureCode: "routine.schedule_invalid",
            failureDetail:
              "The stored schedule is outside the supported horizon.",
            finishedAtMs: 1_700_000_000_000,
            id: "run-quarantine",
            nativeDeliveryId: null,
            organizationId: "org-1",
            publishedSignalId: null,
            routineId: ROUTINE_ID,
            scheduledFor: -300_000,
            startedAtMs: 1_700_000_000_000,
            status: "skipped",
          },
        ],
      })
    );
    const api = createRoutinesApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.listRoutineRuns({
        beforeScheduledFor: -300_000,
        routineId: ROUTINE_ID,
      })
    ).resolves.toMatchObject({
      runs: [{ scheduledFor: -300_000, status: "skipped" }],
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("beforeScheduledFor=-300000"),
      })
    );
  });

  it("uses one shared API surface for every Routine operation", async () => {
    const routineUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/routines";
    const routineDetailUrl = `${routineUrl}/routine%2Fwith%20spaces`;
    const managementRoutineUrl = `${routineUrl}?contract=management-v1`;
    const practicalRoutineUrl = `${routineUrl}?contract=practical-v2`;
    const practicalRoutineDetailUrl = `${routineDetailUrl}?contract=practical-v2`;
    const routineTargetSpacesUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/routine-target-spaces";
    const responseByRoute = new Map<string, () => Response>([
      [
        `GET ${practicalRoutineUrl}`,
        () =>
          jsonResponse({
            currentUserId: "owner-1",
            organizationId: "org-1",
            routines: [ROUTINE],
          }),
      ],
      [
        `GET ${managementRoutineUrl}`,
        () =>
          jsonResponse({
            currentUserId: "owner-1",
            organizationId: "org-1",
            routines: [
              {
                ...ROUTINE,
                capabilityState: {
                  approvedKnowledge: true,
                  canRepair: true,
                  externalActionPolicy: "read_only",
                  slackChannelReport: false,
                },
              },
            ],
          }),
      ],
      [
        `GET ${routineTargetSpacesUrl}`,
        () => jsonResponse(ROUTINE_TARGET_SPACES),
      ],
      [
        `POST ${practicalRoutineUrl}`,
        () => jsonResponse({ routine: ROUTINE }, 201),
      ],
      [
        `PATCH ${practicalRoutineDetailUrl}`,
        () =>
          jsonResponse({ routine: { ...ROUTINE, name: "Updated routine" } }),
      ],
      [
        `POST ${routineDetailUrl}/pause?contract=practical-v2`,
        () =>
          jsonResponse({
            routine: { ...ROUTINE, nextDueAt: null, status: "paused" },
          }),
      ],
      [
        `POST ${routineDetailUrl}/resume?contract=practical-v2`,
        () => jsonResponse({ routine: ROUTINE }),
      ],
      [
        `DELETE ${practicalRoutineDetailUrl}`,
        () =>
          jsonResponse({
            deleted: true,
            organizationId: "org-1",
            routineId: ROUTINE_ID,
          }),
      ],
      [
        `GET ${routineDetailUrl}/runs?beforeScheduledFor=1700000000000&limit=10&contract=practical-v2`,
        () =>
          jsonResponse({
            organizationId: "org-1",
            routineId: ROUTINE_ID,
            runs: [],
          }),
      ],
    ]);
    const transport = vi.fn<OpenMeldApiClientTransport>(
      (call): Promise<Response> => {
        const route = `${call.init?.method ?? "GET"} ${call.url}`;
        const createResponse = responseByRoute.get(route);
        if (!createResponse) {
          throw new Error(`Unexpected Routine API request: ${route}`);
        }
        return Promise.resolve(createResponse());
      }
    );
    const api = createRoutinesApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.listRoutines({ requestContext: REQUEST_CONTEXT });
    await api.listRoutineManagement({ requestContext: REQUEST_CONTEXT });
    await api.listRoutineTargetSpaces({ requestContext: REQUEST_CONTEXT });
    await api.createRoutine({
      authorizedActions: [...AUTHORIZED_ACTIONS],
      cronExpression: ROUTINE.cronExpression,
      destinationKind: ROUTINE.destinationKind,
      externalActionPolicy: "read_only",
      instructions: ROUTINE.instructions,
      name: ROUTINE.name,
      requestContext: REQUEST_CONTEXT,
      runAtMs: ROUTINE.runAtMs,
      scheduleKind: ROUTINE.scheduleKind,
      slackChannelId: ROUTINE.slackChannelId,
      slackConversationId: ROUTINE.slackConversationId,
      slackTeamId: ROUTINE.slackTeamId,
      slackThreadLabel: ROUTINE.slackThreadLabel,
      slackThreadTs: ROUTINE.slackThreadTs,
      targetSpaceId: ROUTINE.targetSpaceId,
      timezone: ROUTINE.timezone,
    });
    await api.updateRoutine({
      authorizedActions: [],
      externalActionPolicy: "standard",
      name: "Updated routine",
      requestContext: REQUEST_CONTEXT,
      routineId: ROUTINE_ID,
    });
    await api.pauseRoutine({
      requestContext: REQUEST_CONTEXT,
      routineId: ROUTINE_ID,
    });
    await api.resumeRoutine({
      requestContext: REQUEST_CONTEXT,
      routineId: ROUTINE_ID,
    });
    await api.deleteRoutine({
      requestContext: REQUEST_CONTEXT,
      routineId: ROUTINE_ID,
    });
    await api.listRoutineRuns({
      beforeScheduledFor: 1_700_000_000_000,
      limit: 10,
      requestContext: REQUEST_CONTEXT,
      routineId: ROUTINE_ID,
    });

    expect(
      transport.mock.calls.map(([call]) => ({
        body: call.init?.body,
        method: call.init?.method,
        operation: call.operation,
        url: call.url,
      }))
    ).toEqual([
      {
        body: undefined,
        method: "GET",
        operation: "routine.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines?contract=practical-v2",
      },
      {
        body: undefined,
        method: "GET",
        operation: "routine.management.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines?contract=management-v1",
      },
      {
        body: undefined,
        method: "GET",
        operation: "routine.target_spaces.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routine-target-spaces",
      },
      {
        body: JSON.stringify({
          authorizedActions: AUTHORIZED_ACTIONS,
          externalActionPolicy: "read_only",
          cronExpression: ROUTINE.cronExpression,
          runAtMs: ROUTINE.runAtMs,
          scheduleKind: ROUTINE.scheduleKind,
          timezone: ROUTINE.timezone,
          destinationKind: ROUTINE.destinationKind,
          slackChannelId: ROUTINE.slackChannelId,
          slackConversationId: ROUTINE.slackConversationId,
          slackTeamId: ROUTINE.slackTeamId,
          slackThreadLabel: ROUTINE.slackThreadLabel,
          slackThreadTs: ROUTINE.slackThreadTs,
          targetSpaceId: ROUTINE.targetSpaceId,
          instructions: ROUTINE.instructions,
          name: ROUTINE.name,
        }),
        method: "POST",
        operation: "routine.create",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines?contract=practical-v2",
      },
      {
        body: JSON.stringify({
          authorizedActions: [],
          externalActionPolicy: "standard",
          name: "Updated routine",
        }),
        method: "PATCH",
        operation: "routine.update",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines/routine%2Fwith%20spaces?contract=practical-v2",
      },
      {
        body: "{}",
        method: "POST",
        operation: "routine.pause",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines/routine%2Fwith%20spaces/pause?contract=practical-v2",
      },
      {
        body: "{}",
        method: "POST",
        operation: "routine.resume",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines/routine%2Fwith%20spaces/resume?contract=practical-v2",
      },
      {
        body: "{}",
        method: "DELETE",
        operation: "routine.delete",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines/routine%2Fwith%20spaces?contract=practical-v2",
      },
      {
        body: undefined,
        method: "GET",
        operation: "routine.runs.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/routines/routine%2Fwith%20spaces/runs?beforeScheduledFor=1700000000000&limit=10&contract=practical-v2",
      },
    ]);
  });

  it("rejects Routine target Space response fields outside the shared contract", async () => {
    const api = createRoutinesApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport: async () =>
          jsonResponse({
            ...ROUTINE_TARGET_SPACES,
            spaces: [
              {
                ...ROUTINE_TARGET_SPACES.spaces[0],
                visibility: "private",
              },
            ],
          }),
      })
    );

    await expect(api.listRoutineTargetSpaces()).rejects.toThrow(
      "invalid Routine target Space list response"
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
