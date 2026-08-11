import {
  CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT,
  CENTER_AGENT_ROUTINE_PRACTICAL_CONTRACT,
  centerAgentRoutineRouteParamsSchema,
  createCenterAgentRoutineBodySchema,
  createCenterAgentRoutineResponseSchema,
  deleteCenterAgentRoutineBodySchema,
  deleteCenterAgentRoutineResponseSchema,
  listCenterAgentRoutineRunsQuerySchema,
  listCenterAgentRoutineRunsResponseSchema,
  listCenterAgentRoutinesManagementResponseSchema,
  listCenterAgentRoutinesResponseSchema,
  listCenterAgentRoutineTargetSpacesResponseSchema,
  pauseCenterAgentRoutineBodySchema,
  pauseCenterAgentRoutineResponseSchema,
  resumeCenterAgentRoutineBodySchema,
  resumeCenterAgentRoutineResponseSchema,
  updateCenterAgentRoutineBodySchema,
  updateCenterAgentRoutineResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildRoutinePath,
  buildRoutinePausePath,
  buildRoutineResumePath,
  buildRoutineRunsPath,
  buildRoutinesPath,
  buildRoutineTargetSpacesPath,
} from "./routes";
import type { CreateRoutinesApi, RoutineRequestInput } from "./types";

const PRACTICAL_ROUTINE_CONTRACT_QUERY = {
  contract: CENTER_AGENT_ROUTINE_PRACTICAL_CONTRACT,
} as const;
const MANAGEMENT_ROUTINE_CONTRACT_QUERY = {
  contract: CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT,
} as const;

export const createRoutinesApi: CreateRoutinesApi = (
  client: OpenMeldApiClientFoundation
) => ({
  listRoutines: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Routine list response",
      method: "GET",
      operation: "routine.list",
      schema: listCenterAgentRoutinesResponseSchema,
      url: buildRoutinesPath(PRACTICAL_ROUTINE_CONTRACT_QUERY),
    }),

  listRoutineManagement: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Routine management response",
      method: "GET",
      operation: "routine.management.list",
      schema: listCenterAgentRoutinesManagementResponseSchema,
      url: buildRoutinesPath(MANAGEMENT_ROUTINE_CONTRACT_QUERY),
    }),

  listRoutineTargetSpaces: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Routine target Space list response",
      method: "GET",
      operation: "routine.target_spaces.list",
      schema: listCenterAgentRoutineTargetSpacesResponseSchema,
      url: buildRoutineTargetSpacesPath(),
    }),

  createRoutine: async (input) => {
    const body = requireValidInput(
      createCenterAgentRoutineBodySchema,
      {
        authorizedActions: input.authorizedActions,
        cronExpression: input.cronExpression,
        destinationKind: input.destinationKind,
        externalActionPolicy: input.externalActionPolicy,
        instructions: input.instructions,
        name: input.name,
        runAtMs: input.runAtMs,
        scheduleKind: input.scheduleKind,
        slackChannelId: input.slackChannelId,
        slackConversationId: input.slackConversationId,
        slackTeamId: input.slackTeamId,
        slackThreadLabel: input.slackThreadLabel,
        slackThreadTs: input.slackThreadTs,
        targetSpaceId: input.targetSpaceId,
        timezone: input.timezone,
      },
      "Routine create request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Routine create response",
      method: "POST",
      operation: "routine.create",
      schema: createCenterAgentRoutineResponseSchema,
      url: buildRoutinesPath(PRACTICAL_ROUTINE_CONTRACT_QUERY),
    });
  },

  updateRoutine: async (input) => {
    const routineId = requireRoutineId(input.routineId);
    const body = requireValidInput(
      updateCenterAgentRoutineBodySchema,
      omitUndefinedValues({
        authorizedActions: input.authorizedActions,
        cronExpression: input.cronExpression,
        destinationKind: input.destinationKind,
        externalActionPolicy: input.externalActionPolicy,
        instructions: input.instructions,
        name: input.name,
        runAtMs: input.runAtMs,
        scheduleKind: input.scheduleKind,
        slackChannelId: input.slackChannelId,
        slackConversationId: input.slackConversationId,
        slackTeamId: input.slackTeamId,
        slackThreadLabel: input.slackThreadLabel,
        slackThreadTs: input.slackThreadTs,
        targetSpaceId: input.targetSpaceId,
        timezone: input.timezone,
      }),
      "Routine update request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Routine update response",
      method: "PATCH",
      operation: "routine.update",
      schema: updateCenterAgentRoutineResponseSchema,
      url: buildRoutinePath(routineId, PRACTICAL_ROUTINE_CONTRACT_QUERY),
    });
  },

  pauseRoutine: async (input) => {
    const routineId = requireRoutineId(input.routineId);
    const body = requireValidInput(
      pauseCenterAgentRoutineBodySchema,
      {},
      "Routine pause request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Routine pause response",
      method: "POST",
      operation: "routine.pause",
      schema: pauseCenterAgentRoutineResponseSchema,
      url: buildRoutinePausePath(routineId, PRACTICAL_ROUTINE_CONTRACT_QUERY),
    });
  },

  resumeRoutine: async (input) => {
    const routineId = requireRoutineId(input.routineId);
    const body = requireValidInput(
      resumeCenterAgentRoutineBodySchema,
      {},
      "Routine resume request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Routine resume response",
      method: "POST",
      operation: "routine.resume",
      schema: resumeCenterAgentRoutineResponseSchema,
      url: buildRoutineResumePath(routineId, PRACTICAL_ROUTINE_CONTRACT_QUERY),
    });
  },

  deleteRoutine: async (input) => {
    const routineId = requireRoutineId(input.routineId);
    const body = requireValidInput(
      deleteCenterAgentRoutineBodySchema,
      {},
      "Routine delete request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Routine delete response",
      method: "DELETE",
      operation: "routine.delete",
      schema: deleteCenterAgentRoutineResponseSchema,
      url: buildRoutinePath(routineId, PRACTICAL_ROUTINE_CONTRACT_QUERY),
    });
  },

  listRoutineRuns: async (input) => {
    const routineId = requireRoutineId(input.routineId);
    const query = requireValidInput(
      listCenterAgentRoutineRunsQuerySchema,
      {
        ...(input.beforeScheduledFor === undefined
          ? {}
          : { beforeScheduledFor: String(input.beforeScheduledFor) }),
        ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
        contract: CENTER_AGENT_ROUTINE_PRACTICAL_CONTRACT,
      },
      "Routine run query is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Routine run list response",
      method: "GET",
      operation: "routine.runs.list",
      schema: listCenterAgentRoutineRunsResponseSchema,
      url: buildRoutineRunsPath(routineId, query),
    });
  },
});

function omitUndefinedValues<T extends Record<string, unknown>>(
  input: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter((entry) => entry[1] !== undefined)
  ) as Partial<T>;
}

function requireRoutineId(value: string): string {
  return requireValidInput(
    centerAgentRoutineRouteParamsSchema,
    { routineId: value },
    "Routine identifier is invalid."
  ).routineId;
}

function requestOptions(input: RoutineRequestInput): {
  requestContext?: RoutineRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid value."}`
    );
  }
  return parsed.data;
}
