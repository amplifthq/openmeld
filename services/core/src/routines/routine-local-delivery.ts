import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { OPENMELD_SPACE_ADDRESSING_VERSION } from "@openmeld/gateway-contract";
import { routineLocalSubmissionSchema } from "@openmeld/schemas";
import type { CenterAgentRoutineRun } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { getDispatchResultByDispatchId } from "../dispatch/application/dispatch-result-service";
import { readPreHeadFailurePublicationState } from "../dispatch/infrastructure/postgresql/pre-head-failure-publication-outbox-repository";
import type { CoreBindings } from "../lib/bindings";
import { isRequestChainEnforced } from "../member-agent/member-agents-feature";
import { rpcPostSignalOnceByClientMessageId } from "../rpc/methods";
import { readRuntimeCoordinatorExecutionProjectionByDispatch } from "../runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import { readSpaceDispatchLookupByClientMessageId } from "../space/infrastructure/postgresql/space-dispatch-read-repo";
import { requireRoutineExecutor } from "./routine-executor";
import {
  markRoutineRunSkipped,
  projectRoutineRunTerminal,
  readRoutineRecord,
  readRoutineRunExecutionRecord,
  type StoredRoutine,
} from "./routine-repository";
import { createRoutineTargetSpaceEligibility } from "./routine-target-space-eligibility";

// Only the admission window expires here. RuntimeCoordinator owns an accepted
// execution, including device waiting, progress, cancellation and its outcome.
const LOCAL_ROUTINE_START_WINDOW_MS = 60 * 60 * 1000;

export async function submitLocalRoutineDelivery(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  nowMs: number;
  routine: StoredRoutine | null;
  run: CenterAgentRoutineRun;
}): Promise<{ status: "pending" | "submitted" | "skipped" | "failed" }> {
  const { db, routine, run } = input;
  const stored = (
    await db.query<{
      local_submission_json: string | null;
      source_signal_id: string | null;
    }>({
      text: "SELECT local_submission_json, source_signal_id FROM openmeld.routine_runs WHERE id = $1 AND execution_engine = 'local' AND status IN ('claimed', 'submitted')",
      values: [run.id],
    })
  ).rows[0];
  if (!stored) {
    return { status: "skipped" };
  }
  if (stored.source_signal_id) {
    return { status: "submitted" };
  }
  if (!stored.local_submission_json) {
    if (
      !routine ||
      routine.status === "paused" ||
      !routine.agentProfileId ||
      !run.targetSpaceId
    ) {
      await markRoutineRunSkipped({
        db,
        runId: run.id,
        nowMs: input.nowMs,
        failureCode: "routine.unavailable",
        failureDetail:
          "The Routine was paused or its Agent or destination is unavailable.",
      });
      return { status: "skipped" };
    }
    const earlier = await db.query({
      text: `SELECT id FROM openmeld.routine_runs WHERE routine_id = $1 AND status IN ('claimed', 'submitted')
        AND (scheduled_for, id) < ($2, $3) LIMIT 1`,
      values: [routine.id, run.scheduledFor, run.id],
    });
    if (earlier.rows.length) {
      await markRoutineRunSkipped({
        db,
        runId: run.id,
        nowMs: input.nowMs,
        failureCode: "routine.previous_run_active",
        failureDetail: "The previous run has not finished.",
      });
      return { status: "skipped" };
    }
    if (input.nowMs > run.scheduledFor + LOCAL_ROUTINE_START_WINDOW_MS) {
      await markRoutineRunSkipped({
        db,
        runId: run.id,
        nowMs: input.nowMs,
        failureCode: "routine.start_window_expired",
        failureDetail: "This run did not start within one hour.",
      });
      return { status: "skipped" };
    }
    const executor = await requireRoutineExecutor({
      db,
      organizationId: routine.organizationId,
      userId: routine.createdByUserId,
      agentProfileId: routine.agentProfileId,
    });
    if (executor.kind !== "local_agent") {
      throw new Error("routine.executor_changed");
    }
    const human = await readActiveRoutineCreator({
      db,
      organizationId: routine.organizationId,
      userId: routine.createdByUserId,
    });
    if (!human) {
      return await skipRunForMissingCreator({ db, nowMs: input.nowMs, run });
    }
    await createRoutineTargetSpaceEligibility({
      db,
      projectionsDb: db,
      agentProfileId: routine.agentProfileId,
    }).requireEligible({
      organizationId: routine.organizationId,
      representedHuman: {
        profileId: human.profile_id,
        userId: routine.createdByUserId,
      },
      targetSpaceId: run.targetSpaceId,
    });
    const binding = await readPrimaryAgentProfileBindingRecord({
      db,
      agentProfileId: routine.agentProfileId,
      owner: { id: routine.createdByUserId, kind: "owner_account" },
    });
    if (!binding) {
      throw new Error("routine.executor_unavailable");
    }
    const submission = routineLocalSubmissionSchema.parse({
      context: {
        activeOrganizationId: routine.organizationId,
        actorContext: {
          callerPrincipalId: routine.createdByUserId,
          ownerUserId: routine.createdByUserId,
          openMeldProfileId: human.profile_id,
          profileKind: "human",
          profileName: human.profile_name,
          requestId: run.id,
        },
      },
      profile: {
        kind: "human",
        profileId: human.profile_id,
        profileName: human.profile_name,
      },
      spaceId: run.targetSpaceId,
      targetProfileId: routine.agentProfileId,
      text: `Scheduled routine: ${routine.name}\n\n${routine.instructions}`,
      deviceWait: {
        bindingId: binding.bindingId,
        openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
        targetProfileId: routine.agentProfileId,
        deadlineAtMs: run.scheduledFor + LOCAL_ROUTINE_START_WINDOW_MS,
      },
    });
    await db.query({
      text: "UPDATE openmeld.routine_runs SET local_submission_json = $1 WHERE id = $2 AND local_submission_json IS NULL AND status = 'claimed'",
      values: [JSON.stringify(submission), run.id],
    });
  }
  const frozen = (
    await db.query<{ local_submission_json: string }>({
      text: "SELECT local_submission_json FROM openmeld.routine_runs WHERE id = $1",
      values: [run.id],
    })
  ).rows[0];
  if (!frozen?.local_submission_json) {
    return { status: "skipped" };
  }
  const submission = routineLocalSubmissionSchema.parse(
    JSON.parse(frozen.local_submission_json)
  );
  if (
    await hasRoutineCreatorLeft({
      db,
      organizationId: run.organizationId,
      userId: submission.context.actorContext.ownerUserId ?? "",
    })
  ) {
    return await skipRunForMissingCreator({ db, nowMs: input.nowMs, run });
  }
  const signal = await rpcPostSignalOnceByClientMessageId(input.env, {
    ...submission,
    // Root: the creator, who authors this message; marker: this Routine.
    requestChainBasis: {
      kind: "source",
      source: "routine",
      sourceId: run.routineId,
    },
    clientMessageId: run.id,
    authoringPolicy: "system_emitted",
    spaceAddressingVersion: OPENMELD_SPACE_ADDRESSING_VERSION,
    spaceAccess: createAuthenticatedSpaceAccessContext({
      requestContext: submission.context,
      spaceId: submission.spaceId,
    }),
    messageEnvelope: {
      text: submission.text,
      activationTargets: [submission.targetProfileId],
      referenceTargets: [],
    },
    meta: { clientMessageId: run.id, purpose: "routine.run" },
  });
  await db.query({
    text: "UPDATE openmeld.routine_runs SET source_signal_id = $1, status = 'submitted' WHERE id = $2 AND status = 'claimed'",
    values: [signal.id, run.id],
  });
  return { status: "submitted" };
}

async function readActiveRoutineCreator(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<{ profile_id: string; profile_name: string } | null> {
  if (!input.userId) {
    return null;
  }
  const result = await input.db.query<{
    profile_id: string;
    profile_name: string;
  }>({
    text: `SELECT p.profile_id, p.profile_name FROM openmeld.openmeld_profiles p
        JOIN openmeld.members m ON m.user_id = p.owner_user_id AND m.organization_id = $1
        WHERE p.owner_user_id = $2 AND p.profile_kind = 'human' AND p.status = 'active' LIMIT 1`,
    values: [input.organizationId, input.userId],
  });
  return result.rows[0] ?? null;
}

/** Once the chain is enforced, a frozen run re-checks its root, the creator. */
async function hasRoutineCreatorLeft(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<boolean> {
  return isRequestChainEnforced() && !(await readActiveRoutineCreator(input));
}

/**
 * The creator is the Wake's root requester; without them the Routine stops.
 * Before the chain is enforced the run keeps its earlier failure.
 */
async function skipRunForMissingCreator(input: {
  db: PostgresDatabase;
  nowMs: number;
  run: CenterAgentRoutineRun;
}): Promise<{ status: "skipped" }> {
  if (!isRequestChainEnforced()) {
    throw new Error("routine.member_unavailable");
  }
  await markRoutineRunSkipped({
    db: input.db,
    runId: input.run.id,
    nowMs: input.nowMs,
    failureCode: "routine.creator_unavailable",
    failureDetail:
      "The person who created this Routine is no longer in this organization.",
  });
  return { status: "skipped" };
}

export async function recoverLocalRoutineRuns(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  nowMs: number;
}) {
  const rows = await input.db.query<{
    id: string;
    routine_id: string;
    organization_id: string;
  }>({
    text: `UPDATE openmeld.routine_runs SET local_last_checked_at_ms=$1 WHERE id IN
      (SELECT id FROM openmeld.routine_runs WHERE execution_engine='local' AND status IN ('claimed','submitted')
       ORDER BY local_last_checked_at_ms, scheduled_for, id LIMIT 50)
      RETURNING id,routine_id,organization_id`,
    values: [input.nowMs],
  });
  for (const row of rows.rows) {
    try {
      const run = await readRoutineRunExecutionRecord({
        db: input.db,
        runId: row.id,
      });
      if (!(run?.targetSpaceId && run.agentProfileIdSnapshot)) {
        continue;
      }
      if (run.status === "claimed") {
        const routine = await readRoutineRecord({
          db: input.db,
          organizationId: row.organization_id,
          routineId: row.routine_id,
        });
        // A frozen submission may already have reached the Space. Recover its
        // idempotent receipt even if its definition was deleted in the meantime.
        await submitLocalRoutineDelivery({ ...input, routine, run });
        continue;
      }
      await reconcileLocalRoutineRun({ ...input, run });
    } catch (error) {
      console.error("[core.routine.local_recovery_failed]", {
        runId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function reconcileLocalRoutineRun(input: {
  db: PostgresDatabase;
  nowMs: number;
  run: Awaited<ReturnType<typeof readRoutineRunExecutionRecord>>;
}) {
  const { run } = input;
  if (!(run?.targetSpaceId && run.agentProfileIdSnapshot)) {
    return;
  }
  const lookup = await readSpaceDispatchLookupByClientMessageId({
    db: input.db,
    clientMessageId: run.id,
    spaceId: run.targetSpaceId,
    targetProfileId: run.agentProfileIdSnapshot,
  });
  const dispatch = lookup.matches[0];
  if (!dispatch) {
    return;
  }
  // Mirror only the execution owner's immutable terminal projection. A
  // message, transport acknowledgement or elapsed time cannot finish a run.
  const execution = await readRuntimeCoordinatorExecutionProjectionByDispatch({
    db: input.db,
    dispatchId: dispatch.dispatchId,
    spaceId: run.targetSpaceId,
    targetProfileId: run.agentProfileIdSnapshot,
  });
  if (
    !(
      execution?.terminalOutcome &&
      ["reply_published", "failed_terminal", "cancelled"].includes(
        execution.status
      )
    )
  ) {
    if (
      !execution &&
      (
        await readPreHeadFailurePublicationState({
          db: input.db,
          dispatchId: dispatch.dispatchId,
        })
      ).status === "completed"
    ) {
      await projectRoutineRunTerminal({
        db: input.db,
        runId: run.id,
        nowMs: input.nowMs,
        status: "failed",
        publishedSignalId: null,
        failureCode: "routine.start_failed",
        failureDetail:
          "The Agent could not start. Open the conversation for details.",
      });
    }
    return;
  }
  const result = await getDispatchResultByDispatchId({
    db: input.db,
    dispatchId: dispatch.dispatchId,
  });
  await projectRoutineRunTerminal({
    db: input.db,
    runId: run.id,
    nowMs: input.nowMs,
    status: execution.status === "reply_published" ? "completed" : "failed",
    publishedSignalId: result?.publishedSignalId ?? null,
    failureCode:
      execution.status === "reply_published"
        ? null
        : (execution.terminalOutcome.reasonCode ??
          `routine.${execution.status}`),
    failureDetail: localRunFailureDetail(execution.status),
  });
}

function localRunFailureDetail(status: string) {
  if (status === "reply_published") {
    return null;
  }
  return status === "cancelled"
    ? "This run was stopped."
    : "The Agent could not complete this run. Open the conversation for details.";
}
