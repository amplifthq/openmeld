import {
  cliJsonOutputEnvelopeSchema,
  createCenterAgentRoutineResponseSchema,
  deleteCenterAgentRoutineResponseSchema,
  gatewayErrorEnvelopeSchema,
  listCenterAgentRoutineRunsResponseSchema,
  listCenterAgentRoutinesResponseSchema,
  pauseCenterAgentRoutineResponseSchema,
  resumeCenterAgentRoutineResponseSchema,
  updateCenterAgentRoutineResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentRoutine,
  CenterAgentRoutineRun,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
  type StoredActiveOrganization,
  setAuthSession,
} from "../src/config/auth-session";
import {
  runRoutinesCreate,
  runRoutinesDelete,
  runRoutinesList,
  runRoutinesPause,
  runRoutinesResume,
  runRoutinesRuns,
  runRoutinesShow,
  runRoutinesUpdate,
} from "../src/routines/command";
import { formatRoutineListSummary } from "../src/routines/presentation";
import type { RunRoutinesCreateInput } from "../src/routines/types";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

type FetchCall = {
  body: unknown;
  method: string;
  pathname: string;
  search: string;
};

const ACTIVE_ORGANIZATION: StoredActiveOrganization = {
  id: "org-1",
  name: "Acme",
  role: "owner",
  slug: "acme",
};

const canUseInteractivePromptsMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

const legacyV1ErrorEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("error"),
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
const UNKNOWN_UPSTREAM_JSON_MESSAGE_PATTERN =
  /Routine scheduler capacity is unavailable.*HTTP status 503.*upstream code scheduler\.capacity_unknown/u;
const INVALID_RESPONSE_JSON_MESSAGE_PATTERN =
  /invalid Routine list response.*HTTP status 200.*schema issue routines\.0\.status: .*Invalid option/u;

type RoutineOutputMode = "agent" | "human" | "json";

type RoutineSuccessContractCase = {
  code: string;
  humanText: string;
  responseSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  run: (mode: RoutineOutputMode) => Promise<void>;
};

const ROUTINE_SUCCESS_CONTRACT_CASES: RoutineSuccessContractCase[] = [
  {
    code: "routines.list",
    humanText: "Routines (1)",
    responseSchema: listCenterAgentRoutinesResponseSchema,
    run: (mode) => runRoutinesList(routineOutputOptions(mode)),
  },
  {
    code: "routines.create",
    humanText: "Routine Created",
    responseSchema: createCenterAgentRoutineResponseSchema,
    run: (mode) =>
      runRoutinesCreate({
        cronExpression: "0 9 * * *",
        instructions: "Triage the Feedback Inbox.",
        name: "Daily feedback triage",
        targetSpaceId: "space-1",
        timezone: "America/Los_Angeles",
        ...routineOutputOptions(mode),
      }),
  },
  {
    code: "routines.show",
    humanText: "Routine Configuration",
    responseSchema: createCenterAgentRoutineResponseSchema,
    run: (mode) =>
      runRoutinesShow({
        routineId: "routine-1",
        ...routineOutputOptions(mode),
      }),
  },
  {
    code: "routines.update",
    humanText: "Routine Updated",
    responseSchema: updateCenterAgentRoutineResponseSchema,
    run: (mode) =>
      runRoutinesUpdate({
        name: "Morning feedback triage",
        routineId: "routine-1",
        ...routineOutputOptions(mode),
      }),
  },
  {
    code: "routines.pause",
    humanText: "Routine Paused",
    responseSchema: pauseCenterAgentRoutineResponseSchema,
    run: (mode) =>
      runRoutinesPause({
        routineId: "routine-1",
        ...routineOutputOptions(mode),
      }),
  },
  {
    code: "routines.resume",
    humanText: "Routine Resumed",
    responseSchema: resumeCenterAgentRoutineResponseSchema,
    run: (mode) =>
      runRoutinesResume({
        routineId: "routine-1",
        ...routineOutputOptions(mode),
      }),
  },
  {
    code: "routines.delete",
    humanText: "Routine Deleted",
    responseSchema: deleteCenterAgentRoutineResponseSchema,
    run: (mode) =>
      runRoutinesDelete({
        routineId: "routine-1",
        yes: true,
        ...routineOutputOptions(mode),
      }),
  },
  {
    code: "routines.runs",
    humanText: "Routine Runs (1)",
    responseSchema: listCenterAgentRoutineRunsResponseSchema,
    run: (mode) =>
      runRoutinesRuns({
        routineId: "routine-1",
        ...routineOutputOptions(mode),
      }),
  },
];

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: (...args: unknown[]) =>
    canUseInteractivePromptsMock(...args),
}));

vi.mock("@clack/prompts", () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => typeof value === "symbol",
}));

describe("routines commands", () => {
  beforeEach(() => {
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);
    confirmMock.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    process.exitCode = undefined;
  });

  it("lists Routines with their human schedule, status, and next run without loading Runs", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesList({ view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Routines (1)");
      expect(result.plainStdout).toContain("Daily feedback triage");
      expect(result.plainStdout).toContain(
        "Every day at 9:00 AM (America/Los_Angeles)"
      );
      expect(result.plainStdout).toContain("Enabled");
      expect(result.plainStdout).toContain("Next run:");
    });

    expect(routineApiCalls(calls)).toEqual([
      {
        body: null,
        method: "GET",
        pathname: "/v1/organizations/current/routines",
        search: "?contract=practical-v2",
      },
    ]);
  });

  it("shows a clear empty state", async () => {
    mockRoutinesFetch({ routines: [] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesList({ view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("No Routines Yet");
      expect(result.plainStdout).toContain(
        "No Routines are configured for Acme."
      );
      expect(result.plainStdout).toContain("openmeld routines create");
    });
  });

  it("emits one canonical list envelope only for explicit --json", async () => {
    mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesList({ json: true, view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      const lines = nonemptyLines(result.stdout);
      expect(lines).toHaveLength(1);
      const envelope = JSON.parse(lines[0] ?? "null") as unknown;
      expect(cliJsonOutputEnvelopeSchema.safeParse(envelope).success).toBe(
        true
      );
      expect(envelope).toMatchObject({
        schemaVersion: 1,
        type: "routines.list",
        currentUserId: "user-1",
        organizationId: "org-1",
        routines: [{ id: "routine-1" }],
      });
    });
  });

  it("emits the existing flat presenter result in Agent View", async () => {
    mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesList({ view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(parseAgentResult(result.stdout)).toMatchObject({
        type: "result",
        code: "routines.list",
        payload: {
          currentUserId: "user-1",
          organizationId: "org-1",
          routines: [{ id: "routine-1" }],
        },
      });
    });
  });

  it.each(
    ROUTINE_SUCCESS_CONTRACT_CASES
  )("keeps Human, Agent, and explicit --json contracts separate for $code", async ({
    code,
    humanText,
    responseSchema,
    run,
  }) => {
    mockRoutinesFetch({
      routines: [routineFixture()],
      runs: [runFixture()],
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const human = await runCommandAndCapture(() => run("human"));
      expect(human.exitCode).toBeUndefined();
      expect(human.plainStdout).toContain(humanText);

      const agent = await runCommandAndCapture(() => run("agent"));
      expect(agent.exitCode).toBeUndefined();
      const agentFrame = parseAgentResult(agent.stdout);
      expect(agentFrame).toMatchObject({ type: "result", code });
      expect(responseSchema.safeParse(agentFrame.payload).success).toBe(true);
      expect(cliJsonOutputEnvelopeSchema.safeParse(agentFrame).success).toBe(
        false
      );

      const json = await runCommandAndCapture(() => run("json"));
      expect(json.exitCode).toBeUndefined();
      expect(parseCanonicalEnvelope(json.stdout)).toMatchObject({
        schemaVersion: 1,
        type: code,
      });
    });
  });

  it("creates a Routine from a validated raw five-field cron expression", async () => {
    const calls = mockRoutinesFetch({ routines: [] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesCreate({
          cronExpression: "0 9 * * *",
          instructions: "Triage the Feedback Inbox.",
          name: "Daily feedback triage",
          targetSpaceId: "space-1",
          timezone: "America/Los_Angeles",
          view: "human",
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Routine Created");
      expect(result.plainStdout).toContain("Daily feedback triage");
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: {
        cronExpression: "0 9 * * *",
        destinationKind: "space",
        instructions: "Triage the Feedback Inbox.",
        name: "Daily feedback triage",
        runAtMs: null,
        scheduleKind: "cron",
        slackChannelId: null,
        slackConversationId: null,
        slackTeamId: null,
        slackThreadLabel: null,
        slackThreadTs: null,
        targetSpaceId: "space-1",
        timezone: "America/Los_Angeles",
      },
      method: "POST",
      pathname: "/v1/organizations/current/routines",
      search: "?contract=practical-v2",
    });
  });

  it("creates a Routine from the shared strict daily shorthand", async () => {
    const calls = mockRoutinesFetch({ routines: [] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesCreate({
          dailyTime: "09:05",
          instructions: "Triage the Feedback Inbox.",
          json: true,
          name: "Daily feedback triage",
          targetSpaceId: "space-1",
          timezone: "America/Los_Angeles",
          view: "human",
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(parseCanonicalEnvelope(result.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "routines.create",
        routine: { id: "routine-1" },
      });
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: {
        cronExpression: "5 9 * * *",
        destinationKind: "space",
        instructions: "Triage the Feedback Inbox.",
        name: "Daily feedback triage",
        runAtMs: null,
        scheduleKind: "cron",
        slackChannelId: null,
        slackConversationId: null,
        slackTeamId: null,
        slackThreadLabel: null,
        slackThreadTs: null,
        targetSpaceId: "space-1",
        timezone: "America/Los_Angeles",
      },
      method: "POST",
      pathname: "/v1/organizations/current/routines",
      search: "?contract=practical-v2",
    });
  });

  it("creates a one-time Routine from an explicit future timestamp", async () => {
    const calls = mockRoutinesFetch({ routines: [] });
    const runAtMs = Date.now() + 86_400_000;
    const runAtIso = new Date(runAtMs).toISOString();

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesCreate({
          instructions: "Confirm the release is healthy.",
          name: "Release follow-up",
          runAtIso,
          targetSpaceId: "space-1",
          view: "human",
        })
      );

      expect(result.exitCode).toBeUndefined();
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: {
        cronExpression: null,
        destinationKind: "space",
        instructions: "Confirm the release is healthy.",
        name: "Release follow-up",
        runAtMs,
        scheduleKind: "once",
        slackChannelId: null,
        slackConversationId: null,
        slackTeamId: null,
        slackThreadLabel: null,
        slackThreadTs: null,
        targetSpaceId: "space-1",
        timezone: null,
      },
      method: "POST",
      pathname: "/v1/organizations/current/routines",
      search: "?contract=practical-v2",
    });
  });

  it.each([
    {
      name: "raw and daily conflict",
      input: { cronExpression: "0 9 * * *", dailyTime: "09:00" },
      code: "routine.schedule.input_conflict",
    },
    {
      name: "missing timezone",
      input: { timezone: undefined },
      code: "routine.schedule.timezone_required",
    },
    {
      name: "missing target Space",
      input: { targetSpaceId: undefined },
      code: "routine.target_space_required",
    },
    {
      name: "schedule more frequent than five minutes",
      input: { cronExpression: "*/4 * * * *" },
      code: "routine.schedule.too_frequent",
    },
    {
      name: "invalid timezone",
      input: { timezone: "PST" },
      code: "routine.schedule.invalid_timezone",
    },
  ])("rejects create input: $name", async ({ input, code }) => {
    const calls = mockRoutinesFetch({ routines: [] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesCreate({
          cronExpression: "0 9 * * *",
          instructions: "Triage the Feedback Inbox.",
          json: true,
          name: "Daily feedback triage",
          targetSpaceId: "space-1",
          timezone: "America/Los_Angeles",
          view: "human",
          ...(input as Partial<RunRoutinesCreateInput>),
        })
      );

      expect(result.exitCode).toBe(1);
      expect(parseCanonicalEnvelope(result.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: { code },
      });
    });

    expect(routineApiCalls(calls)).toEqual([]);
  });

  it("routes local validation errors through the Agent presenter", async () => {
    const calls = mockRoutinesFetch({ routines: [] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesCreate({
          dailyTime: "25:00",
          instructions: "Triage the Feedback Inbox.",
          name: "Daily feedback triage",
          targetSpaceId: "space-1",
          timezone: "America/Los_Angeles",
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      expect(parseAgentError(result.stdout)).toMatchObject({
        type: "error",
        code: "routine.schedule.invalid_daily_time",
        data: {
          status: "error",
          error: { code: "routine.schedule.invalid_daily_time" },
        },
      });
    });

    expect(routineApiCalls(calls)).toEqual([]);
  });

  it("shows one Routine configuration without a second API surface", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesShow({ routineId: "routine-1", view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Routine Configuration");
      expect(result.plainStdout).toContain("Daily feedback triage");
      expect(result.plainStdout).toContain("Triage the Feedback Inbox.");
      expect(result.plainStdout).toContain("space-1");
    });

    expect(routineApiCalls(calls)).toEqual([
      expect.objectContaining({
        method: "GET",
        pathname: "/v1/organizations/current/routines",
      }),
    ]);
  });

  it("emits one flat presenter result for show in Agent View", async () => {
    mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesShow({ routineId: "routine-1", view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(parseAgentResult(result.stdout)).toMatchObject({
        type: "result",
        code: "routines.show",
        payload: { routine: { id: "routine-1" } },
      });
    });
  });

  it("updates only fields explicitly passed by the caller", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesUpdate({
          name: "Morning feedback triage",
          routineId: "routine-1",
          view: "agent",
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(parseAgentResult(result.stdout)).toMatchObject({
        type: "result",
        code: "routines.update",
        payload: { routine: { name: "Morning feedback triage" } },
      });
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: { name: "Morning feedback triage" },
      method: "PATCH",
      pathname: "/v1/organizations/current/routines/routine-1",
      search: "?contract=practical-v2",
    });
  });

  it("uses the shared daily translator when updating a schedule", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesUpdate({
          dailyTime: "16:30",
          routineId: "routine-1",
          timezone: "America/New_York",
          view: "human",
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Routine Updated");
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: {
        cronExpression: "30 16 * * *",
        runAtMs: null,
        scheduleKind: "cron",
        timezone: "America/New_York",
      },
      method: "PATCH",
      pathname: "/v1/organizations/current/routines/routine-1",
      search: "?contract=practical-v2",
    });
  });

  it.each([
    {
      command: runRoutinesPause,
      expectedStatus: "paused",
      path: "/v1/organizations/current/routines/routine-1/pause",
      title: "Routine Paused",
      type: "routines.pause",
    },
    {
      command: runRoutinesResume,
      expectedStatus: "enabled",
      path: "/v1/organizations/current/routines/routine-1/resume",
      title: "Routine Resumed",
      type: "routines.resume",
    },
  ])("uses the Routine API and reports success for $type", async ({
    command,
    expectedStatus,
    path,
    title,
    type,
  }) => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const human = await runCommandAndCapture(() =>
        command({ routineId: "routine-1", view: "human" })
      );
      expect(human.exitCode).toBeUndefined();
      expect(human.plainStdout).toContain(title);

      const agent = await runCommandAndCapture(() =>
        command({ routineId: "routine-1", view: "agent" })
      );
      expect(agent.exitCode).toBeUndefined();
      expect(parseAgentResult(agent.stdout)).toMatchObject({
        type: "result",
        code: type,
        payload: { routine: { status: expectedStatus } },
      });
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: {},
      method: "POST",
      pathname: path,
      search: "?contract=practical-v2",
    });
  });

  it("requires --yes immediately when delete cannot prompt", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesDelete({ routineId: "routine-1", view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      expect(parseAgentError(result.stdout)).toMatchObject({
        type: "error",
        code: "routine.delete.confirmation_required",
        data: {
          status: "error",
          error: { code: "routine.delete.confirmation_required" },
        },
      });
      expect(result.stdout).toContain("--yes");

      const json = await runCommandAndCapture(() =>
        runRoutinesDelete({
          json: true,
          routineId: "routine-1",
          view: "human",
        })
      );
      expect(json.exitCode).toBe(1);
      expect(parseCanonicalEnvelope(json.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: { code: "routine.delete.confirmation_required" },
      });
    });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(routineApiCalls(calls)).toEqual([]);
  });

  it("asks an interactive human to confirm deletion", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesDelete({ routineId: "routine-1", view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Routine Deleted");
    });

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("routine-1"),
      })
    );
    expect(routineApiCalls(calls)).toContainEqual({
      body: {},
      method: "DELETE",
      pathname: "/v1/organizations/current/routines/routine-1",
      search: "?contract=practical-v2",
    });
  });

  it("does not delete when an interactive human declines", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    confirmMock.mockResolvedValue(false);
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesDelete({ routineId: "routine-1", view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Deletion canceled");
    });

    expect(routineApiCalls(calls)).toEqual([]);
  });

  it("deletes with --yes and emits one canonical response envelope", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesDelete({
          json: true,
          routineId: "routine-1",
          view: "human",
          yes: true,
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(parseCanonicalEnvelope(result.stdout)).toMatchObject({
        deleted: true,
        routineId: "routine-1",
        schemaVersion: 1,
        type: "routines.delete",
      });
    });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(routineApiCalls(calls)).toHaveLength(1);
  });

  it("shows completed, failed, and skipped Run outcomes with failure detail", async () => {
    const calls = mockRoutinesFetch({
      routines: [routineFixture()],
      runs: [
        runFixture({ id: "run-completed", status: "completed" }),
        runFixture({
          failureCode: "routine.delivery_failed",
          failureDetail: "The Center Agent could not publish the result.",
          id: "run-failed",
          status: "failed",
        }),
        runFixture({
          failureCode: "routine.target_unavailable",
          failureDetail: "The target Space no longer accepts publications.",
          id: "run-skipped",
          status: "skipped",
        }),
      ],
    });

    await withTempHome(async () => {
      await writeSignedInSession();
      const human = await runCommandAndCapture(() =>
        runRoutinesRuns({ routineId: "routine-1", view: "human" })
      );
      expect(human.exitCode).toBeUndefined();
      expect(human.plainStdout).toContain("Routine Runs (3)");
      expect(human.plainStdout).toContain("Completed");
      expect(human.plainStdout).toContain("Failed");
      expect(human.plainStdout).toContain("Skipped");
      expect(human.plainStdout).toContain(
        "The Center Agent could not publish the result."
      );

      const agent = await runCommandAndCapture(() =>
        runRoutinesRuns({
          beforeScheduledFor: 1_789_100_000_000,
          limit: 3,
          routineId: "routine-1",
          view: "agent",
        })
      );
      expect(agent.exitCode).toBeUndefined();
      expect(parseAgentResult(agent.stdout)).toMatchObject({
        type: "result",
        code: "routines.runs",
        payload: {
          routineId: "routine-1",
          runs: [
            { status: "completed" },
            { status: "failed" },
            { status: "skipped" },
          ],
        },
      });
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: null,
      method: "GET",
      pathname: "/v1/organizations/current/routines/routine-1/runs",
      search: "?beforeScheduledFor=1789100000000&limit=3&contract=practical-v2",
    });
  });

  it("preserves exact pre-epoch quarantine evidence in pagination and presentation", async () => {
    const calls = mockRoutinesFetch({
      routines: [routineFixture()],
      runs: [
        runFixture({
          failureCode: "routine.schedule_invalid",
          failureDetail:
            "The stored schedule is outside the supported horizon.",
          id: "run-quarantine",
          nativeDeliveryId: null,
          publishedSignalId: null,
          scheduledFor: -300_000,
          status: "skipped",
        }),
      ],
    });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesRuns({
          beforeScheduledFor: -300_000,
          routineId: "routine-1",
          view: "human",
        })
      );
      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("1969-12-31T23:55:00.000Z");
      expect(result.plainStdout).toContain("routine.schedule_invalid");
    });

    expect(routineApiCalls(calls)).toContainEqual({
      body: null,
      method: "GET",
      pathname: "/v1/organizations/current/routines/routine-1/runs",
      search: "?beforeScheduledFor=-300000&contract=practical-v2",
    });
  });

  it("naturally shows a future list lastRun without loading Runs", () => {
    const routine = routineFixture({
      lastRun: {
        failureCode: "routine.execution_failed",
        failureDetail: "The hosted turn failed before publication.",
        finishedAtMs: 1_789_086_030_000,
        id: "run-failed",
        publishedSignalId: "signal-failure",
        scheduledFor: 1_789_086_000_000,
        startedAtMs: 1_789_086_001_000,
        status: "failed",
      },
    });

    expect(formatRoutineListSummary(routine)).toContain("Last run: Failed");
  });

  it("preserves unknown canonical upstream diagnostics in every output mode", async () => {
    mockRoutinesFetch({
      failure: {
        code: "scheduler.capacity_unknown",
        message: "Routine scheduler capacity is unavailable.",
        method: "GET",
        pathname: "/v1/organizations/current/routines",
        requestId: "req-scheduler-503",
        status: 503,
      },
      routines: [routineFixture()],
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const agent = await runCommandAndCapture(() =>
        runRoutinesList({ view: "agent" })
      );
      expect(agent.exitCode).toBe(1);
      expect(parseAgentError(agent.stdout)).toMatchObject({
        type: "error",
        code: "upstream_error",
        data: {
          status: "error",
          error: {
            code: "upstream_error",
            message: "Routine scheduler capacity is unavailable.",
          },
          failure: {
            code: "upstream_error",
            message: "Routine scheduler capacity is unavailable.",
            requestId: "req-scheduler-503",
            status: 503,
            upstreamCode: "scheduler.capacity_unknown",
          },
        },
      });

      const json = await runCommandAndCapture(() =>
        runRoutinesList({ json: true, view: "human" })
      );
      expect(json.exitCode).toBe(1);
      const jsonEnvelope = parseLegacyV1ErrorEnvelope(json.stdout);
      expect(jsonEnvelope).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "upstream_error",
          message: expect.stringMatching(UNKNOWN_UPSTREAM_JSON_MESSAGE_PATTERN),
          requestId: "req-scheduler-503",
        },
      });
      expect(
        Object.keys(jsonEnvelope.error as Record<string, unknown>)
      ).toEqual(["code", "message", "requestId"]);

      const human = await runCommandAndCapture(() =>
        runRoutinesList({ view: "human" })
      );
      expect(human.exitCode).toBe(1);
      expect(human.plainStdout).toContain(
        "Routine scheduler capacity is unavailable."
      );
      expect(human.plainStdout).toContain("HTTP Status");
      expect(human.plainStdout).toContain("503");
      expect(human.plainStdout).toContain("scheduler.capacity_unknown");
      expect(human.plainStdout).toContain("req-scheduler-503");
    });
  });

  it("preserves an unknown code-less failure message", async () => {
    mockRoutinesFetch({
      failure: {
        code: "unused",
        method: "GET",
        pathname: "/v1/organizations/current/routines",
        status: 0,
        throwMessage: "Routine transport handshake failed.",
      },
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const json = await runCommandAndCapture(() =>
        runRoutinesList({ json: true, view: "human" })
      );
      expect(json.exitCode).toBe(1);
      expect(parseCanonicalEnvelope(json.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "routine.list_failed",
          message: expect.stringContaining(
            "Routine transport handshake failed."
          ),
        },
      });

      const agent = await runCommandAndCapture(() =>
        runRoutinesList({ view: "agent" })
      );
      expect(agent.exitCode).toBe(1);
      expect(parseAgentError(agent.stdout)).toMatchObject({
        type: "error",
        code: "routine.list_failed",
        data: {
          error: {
            code: "routine.list_failed",
            message: "Routine transport handshake failed.",
          },
          failure: {
            code: null,
            message: "Routine transport handshake failed.",
          },
        },
      });

      const human = await runCommandAndCapture(() =>
        runRoutinesList({ view: "human" })
      );
      expect(human.exitCode).toBe(1);
      expect(human.plainStdout).toContain(
        "Routine transport handshake failed."
      );
    });
  });

  it("preserves invalid-response schema issue path and reason", async () => {
    const invalidRoutine = { ...routineFixture(), status: "mystery" };
    mockRoutinesFetch({
      listRequestId: "req-invalid-routine-list",
      listResponse: {
        currentUserId: "user-1",
        organizationId: "org-1",
        routines: [invalidRoutine],
      },
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const json = await runCommandAndCapture(() =>
        runRoutinesList({ json: true, view: "human" })
      );
      expect(json.exitCode).toBe(1);
      const jsonEnvelope = parseLegacyV1ErrorEnvelope(json.stdout);
      expect(jsonEnvelope).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "gateway.invalid_response",
          message: expect.stringMatching(INVALID_RESPONSE_JSON_MESSAGE_PATTERN),
          requestId: "req-invalid-routine-list",
        },
      });
      expect(
        Object.keys(jsonEnvelope.error as Record<string, unknown>)
      ).toEqual(["code", "message", "requestId"]);

      const agent = await runCommandAndCapture(() =>
        runRoutinesList({ view: "agent" })
      );
      expect(agent.exitCode).toBe(1);
      expect(parseAgentError(agent.stdout)).toMatchObject({
        type: "error",
        code: "gateway.invalid_response",
        data: {
          status: "error",
          failure: {
            code: "gateway.invalid_response",
            requestId: "req-invalid-routine-list",
            schemaIssueMessage: expect.stringContaining("Invalid option"),
            schemaIssuePath: "routines.0.status",
            status: 200,
          },
        },
      });

      const human = await runCommandAndCapture(() =>
        runRoutinesList({ view: "human" })
      );
      expect(human.exitCode).toBe(1);
      expect(human.plainStdout).toContain("routines.0.status");
      expect(human.plainStdout).toContain("Invalid option");
      expect(human.plainStdout).toContain("req-invalid-routine-list");
    });
  });

  it("never exposes a noncanonical HTTP response body as diagnostics", async () => {
    const secret = "Bearer secret-token cookie=session-secret";
    mockRoutinesFetch({
      failure: {
        code: "unused",
        method: "GET",
        pathname: "/v1/organizations/current/routines",
        rawBody: secret,
        requestId: "req-unreadable-502",
        status: 502,
      },
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const json = await runCommandAndCapture(() =>
        runRoutinesList({ json: true, view: "human" })
      );
      expect(json.exitCode).toBe(1);
      expect(parseCanonicalEnvelope(json.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "gateway.http_error",
          message: expect.stringContaining("HTTP 502"),
          requestId: "req-unreadable-502",
        },
      });
      expect(`${json.stdout}\n${json.stderr}`).not.toContain(secret);

      const agent = await runCommandAndCapture(() =>
        runRoutinesList({ view: "agent" })
      );
      expect(agent.exitCode).toBe(1);
      expect(parseAgentError(agent.stdout)).toMatchObject({
        type: "error",
        code: "gateway.http_error",
        data: {
          failure: {
            code: "gateway.http_error",
            message: "OpenMeld Gateway request failed with HTTP 502.",
            requestId: "req-unreadable-502",
            status: 502,
          },
        },
      });
      expect(`${agent.stdout}\n${agent.stderr}`).not.toContain(secret);
    });
  });

  it("preserves a stable permission code and executable next action", async () => {
    mockRoutinesFetch({
      failure: {
        code: "routine.forbidden",
        method: "PATCH",
        pathname: "/v1/organizations/current/routines/routine-1",
        status: 403,
      },
      routines: [routineFixture()],
    });

    await withTempHome(async () => {
      await writeSignedInSession();
      const result = await runCommandAndCapture(() =>
        runRoutinesUpdate({
          name: "Morning triage",
          routineId: "routine-1",
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      expect(parseAgentError(result.stdout)).toMatchObject({
        type: "error",
        code: "routine.forbidden",
        data: {
          status: "error",
          error: {
            code: "routine.forbidden",
            message: expect.stringContaining("organization owner"),
          },
          failure: {
            requestId: "req-routine-test",
            status: 403,
            upstreamCode: "routine.forbidden",
          },
        },
      });

      const json = await runCommandAndCapture(() =>
        runRoutinesUpdate({
          json: true,
          name: "Morning triage",
          routineId: "routine-1",
          view: "human",
        })
      );
      expect(json.exitCode).toBe(1);
      expect(parseCanonicalEnvelope(json.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "routine.forbidden",
          message: expect.stringContaining("organization owner"),
          requestId: "req-routine-test",
        },
      });
    });
  });

  it("uses the shared Center Agent context error presenter in Agent View", async () => {
    const calls = mockRoutinesFetch({ routines: [routineFixture()] });

    await withTempHome(async () => {
      await writeSignedInSession({ activeOrganization: null });
      const result = await runCommandAndCapture(() =>
        runRoutinesList({ view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      expect(parseAgentResult(result.stdout)).toMatchObject({
        type: "result",
        code: "center_agent.organization_required",
        payload: {
          status: "error",
          error: {
            code: "center_agent.organization_required",
            nextStep: expect.stringContaining("openmeld org switch"),
          },
        },
      });

      const json = await runCommandAndCapture(() =>
        runRoutinesList({ json: true, view: "human" })
      );
      expect(json.exitCode).toBe(1);
      expect(parseCanonicalEnvelope(json.stdout)).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "center_agent.organization_required",
          message: expect.stringContaining("openmeld org switch"),
        },
      });
    });

    expect(routineApiCalls(calls)).toEqual([]);
  });
});

function routineFixture(
  input: Partial<CenterAgentRoutine> = {}
): CenterAgentRoutine {
  return {
    canManage: true,
    createdAtMs: 1_789_000_000_000,
    createdByUserId: "user-1",
    cronExpression: "0 9 * * *",
    destinationKind: "space",
    id: "routine-1",
    instructions: "Triage the Feedback Inbox.",
    lastRun: null,
    name: "Daily feedback triage",
    nextDueAt: 1_789_086_000_000,
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
    updatedAtMs: 1_789_000_000_000,
    updatedByUserId: "user-1",
    ...input,
  };
}

function runFixture(
  input: Partial<CenterAgentRoutineRun> = {}
): CenterAgentRoutineRun {
  return {
    failureCode: null,
    failureDetail: null,
    finishedAtMs: 1_789_086_300_000,
    id: "run-1",
    destinationKind: "space",
    nativeDeliveryId: "delivery-1",
    organizationId: "org-1",
    publishedSignalId: "signal-1",
    routineId: "routine-1",
    scheduledFor: 1_789_086_000_000,
    slackChannelId: null,
    slackConversationId: null,
    slackTeamId: null,
    slackThreadLabel: null,
    slackThreadTs: null,
    startedAtMs: 1_789_086_010_000,
    status: "completed",
    targetSpaceId: "space-1",
    ...input,
  };
}

async function writeSignedInSession(
  input: { activeOrganization?: StoredActiveOrganization | null } = {}
): Promise<void> {
  vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-valid",
    activeOrganization:
      input.activeOrganization === undefined
        ? ACTIVE_ORGANIZATION
        : input.activeOrganization,
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    tokenType: "Bearer",
  });
}

function mockRoutinesFetch(input: {
  failure?: {
    code: string;
    gatewayCode?: string;
    method: string;
    message?: string;
    pathname: string;
    rawBody?: string;
    requestId?: string;
    status: number;
    throwMessage?: string;
  };
  listRequestId?: string;
  listResponse?: unknown;
  routines?: CenterAgentRoutine[];
  runs?: CenterAgentRoutineRun[];
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((request: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url;
      const parsedUrl = new URL(url);
      const method = String(
        init?.method ?? (request instanceof Request ? request.method : "GET")
      ).toUpperCase();
      const call = {
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : null,
        method,
        pathname: parsedUrl.pathname,
        search: parsedUrl.search,
      };
      calls.push(call);

      if (
        input.failure?.method === method &&
        input.failure.pathname === call.pathname
      ) {
        if (input.failure.throwMessage !== undefined) {
          throw new Error(input.failure.throwMessage);
        }
        const requestId = input.failure.requestId ?? "req-routine-test";
        if (input.failure.rawBody !== undefined) {
          return new Response(input.failure.rawBody, {
            headers: {
              "content-type": "text/plain",
              "x-openmeld-request-id": requestId,
            },
            status: input.failure.status,
          });
        }
        const errorEnvelope = gatewayErrorEnvelopeSchema.parse({
          error: {
            code: input.failure.gatewayCode ?? "upstream_error",
            message: input.failure.message ?? "Routine operation rejected.",
            requestId,
            upstreamCode: input.failure.code,
          },
          ok: false,
        });
        return new Response(JSON.stringify(errorEnvelope), {
          headers: { "content-type": "application/json" },
          status: input.failure.status,
        });
      }

      if (call.pathname === "/api/auth/get-session" && method === "GET") {
        return jsonResponse({
          session: {
            activeOrganizationId: ACTIVE_ORGANIZATION.id,
            id: "session-1",
          },
          user: { id: "user-1" },
        });
      }
      if (
        call.pathname === "/v1/organizations/current/routines" &&
        method === "GET"
      ) {
        return jsonResponse(
          input.listResponse ?? {
            currentUserId: "user-1",
            organizationId: ACTIVE_ORGANIZATION.id,
            routines: input.routines ?? [],
          },
          input.listRequestId
            ? { "x-openmeld-request-id": input.listRequestId }
            : undefined
        );
      }
      if (
        call.pathname === "/v1/organizations/current/routines" &&
        method === "POST"
      ) {
        return jsonResponse({ routine: routineFixture() });
      }
      const routinePath = "/v1/organizations/current/routines/routine-1";
      if (call.pathname === routinePath && method === "PATCH") {
        return jsonResponse({
          routine: routineFixture(
            typeof call.body === "object" && call.body !== null
              ? (call.body as Partial<CenterAgentRoutine>)
              : {}
          ),
        });
      }
      if (call.pathname === `${routinePath}/pause` && method === "POST") {
        return jsonResponse({ routine: routineFixture({ status: "paused" }) });
      }
      if (call.pathname === `${routinePath}/resume` && method === "POST") {
        return jsonResponse({ routine: routineFixture({ status: "enabled" }) });
      }
      if (call.pathname === routinePath && method === "DELETE") {
        return jsonResponse({
          deleted: true,
          organizationId: "org-1",
          routineId: "routine-1",
        });
      }
      if (call.pathname === `${routinePath}/runs` && method === "GET") {
        return jsonResponse({
          organizationId: "org-1",
          routineId: "routine-1",
          runs: input.runs ?? [],
        });
      }
      return new Response("not found", { status: 404 });
    })
  );
  return calls;
}

function routineApiCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.pathname.includes("/routines"));
}

function jsonResponse(
  payload: unknown,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", ...extraHeaders },
    status: 200,
  });
}

async function runCommandAndCapture(command: () => Promise<void>) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await withCapturedStdio(command);
    return { ...result, exitCode: process.exitCode };
  } finally {
    process.exitCode = previousExitCode;
  }
}

function routineOutputOptions(mode: RoutineOutputMode): {
  json: boolean;
  view: "agent" | "human";
} {
  return {
    json: mode === "json",
    view: mode === "agent" ? "agent" : "human",
  };
}

function nonemptyLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseCanonicalEnvelope(output: string): Record<string, unknown> {
  const lines = nonemptyLines(output);
  if (lines.length !== 1) {
    throw new Error(`Expected one JSON line, received ${lines.length}.`);
  }
  const envelope = JSON.parse(lines[0] ?? "null") as Record<string, unknown>;
  if (!cliJsonOutputEnvelopeSchema.safeParse(envelope).success) {
    throw new Error("Expected a canonical CLI JSON output envelope.");
  }
  return envelope;
}

function parseLegacyV1ErrorEnvelope(output: string): Record<string, unknown> {
  const lines = nonemptyLines(output);
  if (lines.length !== 1) {
    throw new Error(`Expected one JSON line, received ${lines.length}.`);
  }
  return legacyV1ErrorEnvelopeSchema.parse(JSON.parse(lines[0] ?? "null"));
}

function parseAgentResult(output: string): Record<string, unknown> {
  const lines = nonemptyLines(output);
  if (lines.length !== 1) {
    throw new Error(
      `Expected one Agent presenter frame, received ${lines.length}.`
    );
  }
  const frame = JSON.parse(lines[0] ?? "null") as Record<string, unknown>;
  if (
    frame.type !== "result" ||
    typeof frame.code !== "string" ||
    !("payload" in frame) ||
    "schemaVersion" in frame
  ) {
    throw new Error("Expected an Agent presenter result frame.");
  }
  return frame;
}

function parseAgentError(output: string): Record<string, unknown> {
  const lines = nonemptyLines(output);
  if (lines.length !== 1) {
    throw new Error(
      `Expected one Agent presenter error frame, received ${lines.length}.`
    );
  }
  const frame = JSON.parse(lines[0] ?? "null") as Record<string, unknown>;
  if (
    frame.type !== "error" ||
    typeof frame.code !== "string" ||
    typeof frame.message !== "string" ||
    !("data" in frame) ||
    "schemaVersion" in frame
  ) {
    throw new Error("Expected an Agent presenter error frame.");
  }
  return frame;
}
