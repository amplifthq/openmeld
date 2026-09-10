import {
  CENTER_AGENT_ROUTINE_LIMIT,
  CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT,
  CENTER_AGENT_ROUTINE_TARGET_SPACE_LIST_MAX_ITEMS,
  centerAgentRoutineCreationAttributionSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAttribution,
  CenterAgentRoutine,
  CenterAgentRoutineCreationAttribution,
  CenterAgentRoutineManagement,
  CenterAgentRoutineManagementV1,
  CreateCenterAgentRoutineBody,
  DeleteCenterAgentRoutineResponse,
  ListCenterAgentRoutineRunsQuery,
  ListCenterAgentRoutineRunsResponse,
  ListCenterAgentRoutinesManagementResponse,
  ListCenterAgentRoutinesManagementV1Response,
  ListCenterAgentRoutinesResponse,
  ListCenterAgentRoutineTargetSpacesResponse,
  UpdateCenterAgentRoutineBody,
} from "@openmeld/schemas/types";
import {
  canGrantRoutineApprovedKnowledge,
  requireRoutineApprovedKnowledgeGrantAuthority,
} from "../organization-documents/routine-approved-knowledge-grant-policy";
import { readRemoteAgentSlackWorkspaceBinding } from "../remote-agent/infrastructure/d1/slack-workspace-binding-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  canManageRoutine,
  type RoutineAuthority,
  requireRoutineCreateAuthority,
  requireRoutineMutationAuthority,
} from "./routine-authority";
import {
  countRoutineRecords,
  deleteRoutineRecord,
  insertRoutineRecord,
  listRoutineRecords,
  listRoutineRunRecords,
  type NewStoredRoutine,
  pauseRoutineRecord,
  type RoutineAuditActor,
  readRoutineRecord,
  resumeRoutineRecord,
  type StoredRoutine,
  updateRoutineRecord,
} from "./routine-repository";
import { loadRoutineSchedule } from "./routine-schedule-runtime";
import {
  createRoutineTargetSpaceEligibility,
  type RoutineRepresentedHuman,
} from "./routine-target-space-eligibility";

const ROUTINE_RUN_DEFAULT_LIMIT = 25;

export type RoutineActor = {
  attribution: CenterAgentAttribution;
  authority: RoutineAuthority;
  creationDisplayName: string;
  sourceNativeDeliveryId: string | null;
};

export type RoutineService = ReturnType<typeof createRoutineService>;

export function createRoutineService(input: {
  agentProfileId?: string;
  db: D1Database;
  generateId?: () => string;
  now?: () => number;
  projectionsDb: D1Database;
}) {
  const generateId =
    input.generateId ?? (() => `routine_${crypto.randomUUID()}`);
  const now = input.now ?? Date.now;
  const targetSpaceEligibility = createRoutineTargetSpaceEligibility({
    agentProfileId: input.agentProfileId,
    db: input.db,
    projectionsDb: input.projectionsDb,
  });

  return {
    async list(actor: RoutineActor): Promise<ListCenterAgentRoutinesResponse> {
      const routines = await listRoutineRecords({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
      });
      return {
        currentUserId: actor.authority.userId,
        organizationId: actor.authority.organizationId,
        routines: routines.map((routine) =>
          toRoutine(routine, actor.authority)
        ),
      };
    },

    async listManagementV1(
      actor: RoutineActor
    ): Promise<ListCenterAgentRoutinesManagementV1Response> {
      const routines = await listRoutineRecords({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
      });
      return {
        currentUserId: actor.authority.userId,
        organizationId: actor.authority.organizationId,
        routines: routines.map((routine) =>
          toManagementRoutineV1(routine, actor.authority)
        ),
      };
    },

    async listManagement(
      actor: RoutineActor
    ): Promise<ListCenterAgentRoutinesManagementResponse> {
      const routines = await listRoutineRecords({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
      });
      return {
        currentUserId: actor.authority.userId,
        organizationId: actor.authority.organizationId,
        routines: routines.map((routine) =>
          toManagementRoutine(routine, actor.authority)
        ),
      };
    },

    async listTargetSpaces(
      actor: RoutineActor,
      representedHuman: RoutineRepresentedHuman
    ): Promise<ListCenterAgentRoutineTargetSpacesResponse> {
      const organizationId = actor.authority.organizationId;
      return {
        organizationId,
        spaces: await targetSpaceEligibility.listEligible({
          limit: CENTER_AGENT_ROUTINE_TARGET_SPACE_LIST_MAX_ITEMS,
          organizationId,
          representedHuman,
        }),
      };
    },

    async create(
      actor: RoutineActor,
      representedHuman: RoutineRepresentedHuman,
      body: CreateCenterAgentRoutineBody
    ): Promise<CenterAgentRoutine> {
      requireRoutineCreateAuthority(actor.authority);
      requirePersonalRoutineCapabilities(input.agentProfileId, body);
      const authorizedActions = body.authorizedActions ?? [];
      requireRoutineApprovedKnowledgeGrantAuthority({
        currentActions: [],
        nextActions: authorizedActions,
        role: actor.authority.role,
      });
      const nowMs = now();
      const schedule = await requireValidSchedule(body, nowMs);
      const creationAttribution =
        centerAgentRoutineCreationAttributionSchema.parse({
          displayName: actor.creationDisplayName,
        });
      await requireValidDestination({
        body,
        db: input.db,
        organizationId: actor.authority.organizationId,
        representedHuman,
        targetSpaceEligibility,
      });
      const routine: NewStoredRoutine = {
        agentProfileId: input.agentProfileId ?? null,
        authorizedActions,
        createdAtMs: nowMs,
        createdByUserId: actor.authority.userId,
        creationAttribution,
        cronExpression: schedule.cronExpression,
        destinationKind: body.destinationKind,
        externalActionPolicy: body.externalActionPolicy ?? "standard",
        id: generateId(),
        instructions: body.instructions,
        lastRun: null,
        name: body.name,
        nextDueAt: schedule.nextDueAt,
        organizationId: actor.authority.organizationId,
        runAtMs: schedule.runAtMs,
        scheduleKind: schedule.scheduleKind,
        slackChannelId: body.slackChannelId,
        slackConversationId: body.slackConversationId,
        slackTeamId: body.slackTeamId,
        slackThreadLabel: body.slackThreadLabel,
        slackThreadTs: body.slackThreadTs,
        status: "enabled",
        targetSpaceId: body.targetSpaceId,
        timezone: schedule.timezone,
        updatedAtMs: nowMs,
        updatedByUserId: actor.authority.userId,
      };
      const insertOutcome = await insertRoutineRecord({
        actor: toAuditActor(actor),
        db: input.db,
        limit: CENTER_AGENT_ROUTINE_LIMIT,
        routine,
      });
      if (insertOutcome === "not_inserted") {
        return await throwRoutineQuotaError(
          input.db,
          actor.authority.organizationId
        );
      }
      const created = await requireRoutineAfterSuccessfulMutation({
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId: routine.id,
      });
      return toRoutine(created, actor.authority);
    },

    async update(
      actor: RoutineActor,
      representedHuman: RoutineRepresentedHuman,
      routineId: string,
      body: UpdateCenterAgentRoutineBody
    ): Promise<CenterAgentRoutine> {
      const current = await requireRoutine({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      requireRoutineMutationAuthority({
        action: "update",
        authority: actor.authority,
        createdByUserId: current.createdByUserId,
      });
      const authorizedActions =
        body.authorizedActions ?? current.authorizedActions;
      requireRoutineApprovedKnowledgeGrantAuthority({
        currentActions: current.authorizedActions,
        nextActions: authorizedActions,
        role: actor.authority.role,
      });
      const nowMs = now();
      const candidate = {
        ...current,
        ...body,
      };
      requirePersonalRoutineCapabilities(input.agentProfileId, candidate);
      const schedule = await requireValidSchedule(
        {
          cronExpression: candidate.cronExpression,
          runAtMs: candidate.runAtMs,
          scheduleKind: candidate.scheduleKind,
          timezone: candidate.timezone,
        },
        nowMs
      );
      await requireValidDestination({
        body: candidate,
        db: input.db,
        organizationId: actor.authority.organizationId,
        representedHuman,
        targetSpaceEligibility,
      });
      const updateOutcome = await updateRoutineRecord({
        actor: toAuditActor(actor),
        db: input.db,
        routine: {
          ...current,
          authorizedActions,
          cronExpression: schedule.cronExpression,
          destinationKind: candidate.destinationKind,
          externalActionPolicy:
            body.externalActionPolicy ?? current.externalActionPolicy,
          instructions: body.instructions ?? current.instructions,
          name: body.name ?? current.name,
          nextDueAt: current.status === "enabled" ? schedule.nextDueAt : null,
          runAtMs: schedule.runAtMs,
          scheduleKind: schedule.scheduleKind,
          slackChannelId: candidate.slackChannelId,
          slackConversationId: candidate.slackConversationId,
          slackTeamId: candidate.slackTeamId,
          slackThreadLabel: candidate.slackThreadLabel,
          slackThreadTs: candidate.slackThreadTs,
          targetSpaceId: candidate.targetSpaceId,
          timezone: schedule.timezone,
          updatedAtMs: nowMs,
          updatedByUserId: actor.authority.userId,
        },
      });
      if (updateOutcome === "not_updated") {
        await requireRoutineAfterFailedMutation({
          db: input.db,
          organizationId: actor.authority.organizationId,
          routineId,
        });
        throw routineStatusConflictError(
          "Routine changed before the update could be applied."
        );
      }
      const updated = await requireRoutineAfterSuccessfulMutation({
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      return toRoutine(updated, actor.authority);
    },

    async pause(
      actor: RoutineActor,
      routineId: string
    ): Promise<CenterAgentRoutine> {
      const current = await requireRoutine({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      requireRoutineMutationAuthority({
        action: "update",
        authority: actor.authority,
        createdByUserId: current.createdByUserId,
      });
      if (current.status !== "enabled") {
        throw routineStatusConflictError("Routine is already paused.");
      }
      const pauseOutcome = await pauseRoutineRecord({
        actor: toAuditActor(actor),
        db: input.db,
        nowMs: now(),
        organizationId: actor.authority.organizationId,
        routineId,
        updatedByUserId: actor.authority.userId,
      });
      if (pauseOutcome === "not_updated") {
        const latest = await requireRoutineAfterFailedMutation({
          db: input.db,
          organizationId: actor.authority.organizationId,
          routineId,
        });
        throw routineStatusConflictError(
          latest.status === "paused"
            ? "Routine is already paused."
            : "Routine changed before it could be paused."
        );
      }
      const paused = await requireRoutineAfterSuccessfulMutation({
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      return toRoutine(paused, actor.authority);
    },

    async resume(
      actor: RoutineActor,
      representedHuman: RoutineRepresentedHuman,
      routineId: string
    ): Promise<CenterAgentRoutine> {
      const current = await requireRoutine({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      requireRoutineMutationAuthority({
        action: "update",
        authority: actor.authority,
        createdByUserId: current.createdByUserId,
      });
      if (current.status !== "paused") {
        throw routineStatusConflictError("Routine is already enabled.");
      }
      const nowMs = now();
      const schedule = await requireValidSchedule(current, nowMs);
      await requireValidDestination({
        body: current,
        db: input.db,
        organizationId: actor.authority.organizationId,
        representedHuman,
        targetSpaceEligibility,
      });
      const resumeOutcome = await resumeRoutineRecord({
        actor: toAuditActor(actor),
        db: input.db,
        nextDueAt: schedule.nextDueAt,
        nowMs,
        organizationId: actor.authority.organizationId,
        routineId,
        updatedByUserId: actor.authority.userId,
      });
      if (resumeOutcome === "not_updated") {
        const latest = await requireRoutineAfterFailedMutation({
          db: input.db,
          organizationId: actor.authority.organizationId,
          routineId,
        });
        if (latest.status === "enabled") {
          throw routineStatusConflictError("Routine is already enabled.");
        }
        throw routineStatusConflictError(
          "Routine changed before it could be resumed."
        );
      }
      const resumed = await requireRoutineAfterSuccessfulMutation({
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      return toRoutine(resumed, actor.authority);
    },

    async delete(
      actor: RoutineActor,
      routineId: string
    ): Promise<DeleteCenterAgentRoutineResponse> {
      const current = await requireRoutine({
        agentProfileId: input.agentProfileId,
        db: input.db,
        organizationId: actor.authority.organizationId,
        routineId,
      });
      requireRoutineMutationAuthority({
        action: "delete",
        authority: actor.authority,
        createdByUserId: current.createdByUserId,
      });
      const deleteOutcome = await deleteRoutineRecord({
        actor: toAuditActor(actor),
        db: input.db,
        nowMs: now(),
        organizationId: actor.authority.organizationId,
        routineId,
      });
      if (deleteOutcome === "not_deleted") {
        await requireRoutineAfterFailedMutation({
          db: input.db,
          organizationId: actor.authority.organizationId,
          routineId,
        });
        throw routineStatusConflictError(
          "Routine changed before it could be deleted."
        );
      }
      return {
        deleted: true,
        organizationId: actor.authority.organizationId,
        routineId,
      };
    },

    async listRuns(
      actor: RoutineActor,
      routineId: string,
      query: ListCenterAgentRoutineRunsQuery
    ): Promise<ListCenterAgentRoutineRunsResponse> {
      const limit = Math.min(
        query.limit ?? ROUTINE_RUN_DEFAULT_LIMIT,
        CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT
      );
      return {
        organizationId: actor.authority.organizationId,
        routineId,
        runs: await listRoutineRunRecords({
          agentProfileId: input.agentProfileId,
          beforeScheduledFor: query.beforeScheduledFor,
          db: input.db,
          limit,
          organizationId: actor.authority.organizationId,
          routineId,
        }),
      };
    },
  };
}

function requirePersonalRoutineCapabilities(
  agentProfileId: string | undefined,
  body: { destinationKind: string; authorizedActions?: readonly string[] }
) {
  if (
    agentProfileId &&
    (body.destinationKind !== "space" ||
      (body.authorizedActions?.length ?? 0) > 0)
  ) {
    throw createCoreRpcHttpError({
      code: "routine.forbidden",
      reason:
        "Personal Agent Routines use Spaces and cannot grant Center Agent actions.",
      status: 403,
    });
  }
}

async function requireRoutine(input: {
  agentProfileId?: string;
  db: D1Database;
  organizationId: string;
  routineId: string;
}): Promise<StoredRoutine> {
  const routine = await readRoutineRecord(input);
  if (
    !routine ||
    (routine.agentProfileId ?? null) !== (input.agentProfileId ?? null)
  ) {
    throw routineNotFoundError();
  }
  return routine;
}

async function requireRoutineAfterSuccessfulMutation(input: {
  db: D1Database;
  organizationId: string;
  routineId: string;
}): Promise<StoredRoutine> {
  const routine = await readRoutineRecord(input);
  if (!routine) {
    throw routineNotFoundError();
  }
  return routine;
}

async function requireRoutineAfterFailedMutation(input: {
  db: D1Database;
  organizationId: string;
  routineId: string;
}): Promise<StoredRoutine> {
  const routine = await readRoutineRecord(input);
  if (!routine) {
    throw routineNotFoundError();
  }
  return routine;
}

async function requireValidSchedule(
  input: {
    cronExpression: string | null;
    runAtMs: number | null;
    scheduleKind: "cron" | "once";
    timezone: string | null;
  },
  nowMs: number
): Promise<{
  cronExpression: string | null;
  nextDueAt: number;
  runAtMs: number | null;
  scheduleKind: "cron" | "once";
  timezone: string | null;
}> {
  if (input.scheduleKind === "once") {
    if (
      input.runAtMs === null ||
      input.cronExpression !== null ||
      input.timezone !== null
    ) {
      throw createCoreRpcHttpError({
        status: 400,
        reason:
          "A one-time Routine requires runAtMs and no recurring schedule fields.",
        code: "routine.schedule.invalid_reference_time",
      });
    }
    if (input.runAtMs <= nowMs) {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "Choose a future time for this one-time Routine.",
        code: "routine.schedule.run_at_past",
      });
    }
    return {
      cronExpression: null,
      nextDueAt: input.runAtMs,
      runAtMs: input.runAtMs,
      scheduleKind: "once",
      timezone: null,
    };
  }
  if (!(input.cronExpression && input.timezone) || input.runAtMs !== null) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        "A recurring Routine requires cronExpression and timezone and cannot include runAtMs.",
      code: "routine.schedule.invalid_cron",
    });
  }
  const routineSchedule = await loadRoutineSchedule();
  try {
    const schedule = routineSchedule.validateRoutineSchedule({
      cronExpression: input.cronExpression,
      timezone: input.timezone,
    });
    return {
      ...schedule,
      nextDueAt: await nextRecurringDueAt(schedule, nowMs),
      runAtMs: null,
      scheduleKind: "cron",
    };
  } catch (error) {
    if (error instanceof routineSchedule.RoutineScheduleValidationError) {
      throw createCoreRpcHttpError({
        status: 400,
        reason: error.message,
        code: error.code,
      });
    }
    throw error;
  }
}

async function nextRecurringDueAt(
  schedule: { cronExpression: string; timezone: string },
  afterMs: number
): Promise<number> {
  const routineSchedule = await loadRoutineSchedule();
  return routineSchedule
    .getNextStoredRoutineOccurrence({
      ...schedule,
      after: afterMs,
    })
    .getTime();
}

async function requireValidDestination(input: {
  body: Pick<
    CreateCenterAgentRoutineBody,
    | "destinationKind"
    | "slackChannelId"
    | "slackConversationId"
    | "slackTeamId"
    | "slackThreadTs"
    | "targetSpaceId"
  >;
  db: D1Database;
  organizationId: string;
  representedHuman: RoutineRepresentedHuman;
  targetSpaceEligibility: ReturnType<
    typeof createRoutineTargetSpaceEligibility
  >;
}): Promise<void> {
  if (input.body.destinationKind === "space") {
    if (!input.body.targetSpaceId) {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "Choose a target Space for this Routine.",
        code: "routine.target_space_not_found",
      });
    }
    await input.targetSpaceEligibility.requireEligible({
      organizationId: input.organizationId,
      representedHuman: input.representedHuman,
      targetSpaceId: input.body.targetSpaceId,
    });
    return;
  }

  const { slackChannelId, slackConversationId, slackTeamId, slackThreadTs } =
    input.body;
  if (
    !(slackChannelId && slackConversationId && slackTeamId && slackThreadTs) ||
    slackConversationId !==
      `slack:${slackTeamId}:${slackChannelId}:${slackThreadTs}`
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "The Slack thread destination is incomplete.",
      code: "routine.slack_thread_unavailable",
    });
  }
  const workspaceBinding = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId,
  });
  if (workspaceBinding?.organizationId !== input.organizationId) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "That Slack thread is not connected to the current OpenMeld Organization.",
      code: "routine.slack_thread_unavailable",
    });
  }
}

async function throwRoutineQuotaError(
  db: D1Database,
  organizationId: string
): Promise<never> {
  const counts = await countRoutineRecords({ db, organizationId });
  if (counts.total >= CENTER_AGENT_ROUTINE_LIMIT) {
    throw createCoreRpcHttpError({
      status: 409,
      reason: `An Organization can have at most ${CENTER_AGENT_ROUTINE_LIMIT} Routines.`,
      code: "routine.total_limit_reached",
    });
  }
  throw routineStatusConflictError("Routine could not be created.");
}

function routineNotFoundError(): Error {
  return createCoreRpcHttpError({
    status: 404,
    reason: "Routine could not be found.",
    code: "routine.not_found",
  });
}

function routineStatusConflictError(reason: string): Error {
  return createCoreRpcHttpError({
    status: 409,
    reason,
    code: "routine.status_conflict",
  });
}

function toRoutine(
  routine: StoredRoutine,
  authority: RoutineAuthority
): CenterAgentRoutine {
  const {
    agentProfileId: _agentProfileId,
    authorizedActions: _authorizedActions,
    creationAttribution: _creationAttribution,
    externalActionPolicy: _externalActionPolicy,
    ...publicRoutine
  } = routine;
  return {
    ...publicRoutine,
    canManage: canManageRoutine({
      authority,
      createdByUserId: routine.createdByUserId,
    }),
  };
}

function toManagementRoutineV1(
  routine: StoredRoutine,
  authority: RoutineAuthority
): CenterAgentRoutineManagementV1 {
  const approvedKnowledge = routine.authorizedActions.includes(
    "organization_documents.save_approved_knowledge"
  );
  return {
    ...toRoutine(routine, authority),
    capabilityState: {
      approvedKnowledge,
      canRepair:
        canManageRoutine({
          authority,
          createdByUserId: routine.createdByUserId,
        }) &&
        (approvedKnowledge || canGrantRoutineApprovedKnowledge(authority.role)),
      externalActionPolicy: routine.externalActionPolicy,
      slackChannelReport: routine.authorizedActions.includes(
        "slack.publish_channel_report"
      ),
    },
  };
}

function toManagementRoutine(
  routine: StoredRoutine,
  authority: RoutineAuthority
): CenterAgentRoutineManagement {
  const creationAttribution: CenterAgentRoutineCreationAttribution =
    routine.creationAttribution ?? { displayName: null };
  return {
    ...toManagementRoutineV1(routine, authority),
    creationAttribution,
  };
}

function toAuditActor(actor: RoutineActor): RoutineAuditActor {
  return {
    ...actor.attribution,
    sourceNativeDeliveryId: actor.sourceNativeDeliveryId,
  };
}
