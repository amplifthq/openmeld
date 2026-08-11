import { describe, expect, it, vi } from "vitest";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import app from "../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ROUTINE_ID = "routine_11111111-1111-4111-8111-111111111111";

const ROUTINE = {
  canManage: true,
  createdAtMs: 1_700_000_000_000,
  createdByUserId: "owner-1",
  cronExpression: "0 9 * * *",
  id: ROUTINE_ID,
  instructions: "Review new Feedback Inbox issues.",
  lastRun: null,
  name: "Daily feedback review",
  nextDueAt: 1_700_003_600_000,
  organizationId: "org-1",
  scheduleKind: "cron" as const,
  status: "enabled" as const,
  targetSpaceId: "space-1",
  timezone: "America/Los_Angeles",
  updatedAtMs: 1_700_000_000_000,
  updatedByUserId: "owner-1",
};
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

type CoreRpcMock = {
  createRoutine: ReturnType<typeof vi.fn>;
  deleteRoutine: ReturnType<typeof vi.fn>;
  listRoutineRuns: ReturnType<typeof vi.fn>;
  listRoutineTargetSpaces: ReturnType<typeof vi.fn>;
  listRoutines: ReturnType<typeof vi.fn>;
  pauseRoutine: ReturnType<typeof vi.fn>;
  resumeRoutine: ReturnType<typeof vi.fn>;
  updateRoutine: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

describe("Routine routes", () => {
  it("forwards the complete Routine HTTP surface to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const requests = [
      new Request("http://local/v1/organizations/current/routines"),
      new Request(
        "http://local/v1/organizations/current/routine-target-spaces"
      ),
      jsonRequest("http://local/v1/organizations/current/routines", "POST", {
        cronExpression: "0 9 * * *",
        instructions: ROUTINE.instructions,
        name: ROUTINE.name,
        targetSpaceId: ROUTINE.targetSpaceId,
        timezone: ROUTINE.timezone,
      }),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}`,
        "PATCH",
        { name: "Updated routine" }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/pause`,
        "POST",
        {}
      ),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/resume`,
        "POST",
        {}
      ),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}`,
        "DELETE",
        {}
      ),
      new Request(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/runs?limit=10&beforeScheduledFor=1700000000000`
      ),
    ];

    const responses: Response[] = [];
    for (const request of requests) {
      responses.push(await app.fetch(request, env, TEST_EXECUTION_CONTEXT));
    }
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 201, 200, 200, 200, 200, 200,
    ]);
    await expect(responses[0]?.clone().json()).resolves.toMatchObject({
      routines: [expect.not.objectContaining({ destinationKind: "space" })],
    });
    expect(coreRpc.listRoutines).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    expect(coreRpc.listRoutineTargetSpaces).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    expect(coreRpc.createRoutine).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: "0 9 * * *",
        targetSpaceId: "space-1",
        timezone: "America/Los_Angeles",
      })
    );
    expect(coreRpc.updateRoutine).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Updated routine",
        routineId: ROUTINE_ID,
      })
    );
    expect(coreRpc.pauseRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ routineId: ROUTINE_ID })
    );
    expect(coreRpc.resumeRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ routineId: ROUTINE_ID })
    );
    expect(coreRpc.deleteRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ routineId: ROUTINE_ID })
    );
    expect(coreRpc.listRoutineRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeScheduledFor: 1_700_000_000_000,
        limit: 10,
        routineId: ROUTINE_ID,
      })
    );
  });

  it("opts new clients into the practical Routine contract", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/routines?contract=practical-v2"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      routines: [
        {
          destinationKind: "space",
          runAtMs: null,
          slackChannelId: null,
        },
      ],
    });
    expect(coreRpc.listRoutines).toHaveBeenCalledWith(
      expect.objectContaining({ contract: "practical-v2" })
    );
  });

  it("returns Core-owned capability state through the management contract", async () => {
    const { coreRpc, env } = makeEnv({
      coreOverrides: {
        listRoutines: vi.fn(async () => ({
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
        })),
      },
    });
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/routines?contract=management-v1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      routines: [
        {
          capabilityState: {
            approvedKnowledge: true,
            canRepair: true,
            externalActionPolicy: "read_only",
            slackChannelReport: false,
          },
        },
      ],
    });
    expect(coreRpc.listRoutines).toHaveBeenCalledWith(
      expect.objectContaining({ contract: "management-v1" })
    );
  });

  it("rejects unknown Routine contract versions before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/routines?contract=future-v3"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.listRoutines).not.toHaveBeenCalled();
  });

  it("rejects unknown fields on every Routine write before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const invalidRequests = [
      jsonRequest("http://local/v1/organizations/current/routines", "POST", {
        ...ROUTINE,
        unknown: true,
      }),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}`,
        "PATCH",
        { name: "Updated", unknown: true }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/pause`,
        "POST",
        { unknown: true }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/resume`,
        "POST",
        { unknown: true }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}`,
        "DELETE",
        { unknown: true }
      ),
    ];

    for (const request of invalidRequests) {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_payload" },
        ok: false,
      });
    }
    expect(coreRpc.createRoutine).not.toHaveBeenCalled();
    expect(coreRpc.updateRoutine).not.toHaveBeenCalled();
    expect(coreRpc.pauseRoutine).not.toHaveBeenCalled();
    expect(coreRpc.resumeRoutine).not.toHaveBeenCalled();
    expect(coreRpc.deleteRoutine).not.toHaveBeenCalled();
  });

  it("rejects unknown Routine target Space query fields before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/routine-target-spaces?unknown=1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_payload" },
      ok: false,
    });
    expect(coreRpc.listRoutineTargetSpaces).not.toHaveBeenCalled();
  });

  it("rejects Routine target Space response fields outside the shared contract", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        listRoutineTargetSpaces: vi.fn(async () => ({
          ...ROUTINE_TARGET_SPACES,
          spaces: [
            {
              ...ROUTINE_TARGET_SPACES.spaces[0],
              visibility: "private",
            },
          ],
        })),
      },
    });
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/routine-target-spaces"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "upstream_error",
        message: "upstream returned invalid response payload",
      },
      ok: false,
    });
  });

  it("accepts signed quarantine cursors and rejects unrelated negative Run records", async () => {
    const quarantineRun = {
      failureCode: "routine.schedule_invalid",
      failureDetail: "The stored schedule is outside the supported horizon.",
      finishedAtMs: 1_700_000_000_000,
      id: "run-quarantine",
      nativeDeliveryId: null,
      organizationId: "org-1",
      publishedSignalId: null,
      routineId: ROUTINE_ID,
      scheduledFor: -300_000,
      startedAtMs: 1_700_000_000_000,
      status: "skipped",
    } as const;
    const valid = makeEnv({
      coreOverrides: {
        listRoutineRuns: vi.fn(async () => ({
          organizationId: "org-1",
          routineId: ROUTINE_ID,
          runs: [quarantineRun],
        })),
      },
    });
    const validResponse = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/runs?beforeScheduledFor=-300000`
      ),
      valid.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(validResponse.status).toBe(200);
    expect(valid.coreRpc.listRoutineRuns).toHaveBeenCalledWith(
      expect.objectContaining({ beforeScheduledFor: -300_000 })
    );

    const invalid = makeEnv({
      coreOverrides: {
        listRoutineRuns: vi.fn(async () => ({
          organizationId: "org-1",
          routineId: ROUTINE_ID,
          runs: [{ ...quarantineRun, failureCode: null, status: "failed" }],
        })),
      },
    });
    const invalidResponse = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}/runs`
      ),
      invalid.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(invalidResponse.status).toBe(502);
  });

  it("preserves stable Routine authorization errors", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        deleteRoutine: vi.fn(() =>
          Promise.reject(
            createCoreRpcHttpError({
              code: "routine.forbidden",
              reason: "You do not have permission to manage this Routine.",
              status: 403,
            })
          )
        ),
      },
    });

    const response = await app.fetch(
      jsonRequest(
        `http://local/v1/organizations/current/routines/${ROUTINE_ID}`,
        "DELETE",
        {}
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "routine.forbidden" },
      ok: false,
    });
  });
});

function makeEnv(input?: { coreOverrides?: Partial<CoreRpcMock> }) {
  const coreRpc: CoreRpcMock = {
    createRoutine: vi.fn(async () => ({ routine: ROUTINE })),
    deleteRoutine: vi.fn(async () => ({
      deleted: true,
      organizationId: "org-1",
      routineId: ROUTINE_ID,
    })),
    listRoutineRuns: vi.fn(async () => ({
      organizationId: "org-1",
      routineId: ROUTINE_ID,
      runs: [],
    })),
    listRoutineTargetSpaces: vi.fn(async () => ROUTINE_TARGET_SPACES),
    listRoutines: vi.fn(async () => ({
      currentUserId: "owner-1",
      organizationId: "org-1",
      routines: [ROUTINE],
    })),
    pauseRoutine: vi.fn(async () => ({
      routine: { ...ROUTINE, nextDueAt: null, status: "paused" },
    })),
    resumeRoutine: vi.fn(async () => ({ routine: ROUTINE })),
    updateRoutine: vi.fn(async () => ({
      routine: { ...ROUTINE, name: "Updated routine" },
    })),
    ...(input?.coreOverrides ?? {}),
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
        openMeldProfileId: HUMAN_PROFILE_ID,
      },
    })),
    resolveRequestAuth: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authenticated: true,
        authMethod: "session",
        ownerIds: ["owner-1"],
        requestId: "req-routine-route",
      },
      ok: true,
    })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authenticated: true,
        authMethod: "session",
        ownerIds: ["owner-1"],
        requestId: "req-routine-route",
      },
      ok: true,
      profile: {
        ok: true,
        resolvedProfile: {
          ownerUserId: "owner-1",
          profileKind: "human",
          profileName: "Mira",
          openMeldProfileId: HUMAN_PROFILE_ID,
        },
      },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function jsonRequest(
  url: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}
