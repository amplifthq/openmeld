import {
  getCenterAgentMemberResearchStatusResponseSchema,
  getCenterAgentMemberResearchStatusRpcInputSchema,
  startCenterAgentMemberResearchResponseSchema,
  startCenterAgentMemberResearchRpcInputSchema,
} from "@openmeld/schemas";
import type {
  GetCenterAgentMemberResearchStatusResponse,
  GetCenterAgentMemberResearchStatusRpcInput,
  StartCenterAgentMemberResearchResponse,
  StartCenterAgentMemberResearchRpcInput,
} from "@openmeld/schemas/types";
import {
  prepareCenterAgentAuditJournalEntryStatement,
  readCenterAgentDesignationRecord,
  resolveCenterAgentAttribution,
} from "../center-agent/center-agent-repository";
import { type CoreBindings, localStateDb } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import {
  type RemoteAgentMemberResearchDeliveryInput,
  submitRemoteAgentMemberResearchDelivery,
} from "../remote-agent/application/native-delivery-service";
import { readRemoteAgentNativeDeliveryByIdempotencyKey } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  type ResearchBatchRow,
  type ResearchTaskRow,
  readActiveResearchBatch,
  readResearchBatchById,
  readResearchRequester,
  readResearchSubjects,
  readStoredResearchBatch,
} from "./member-research-repository";

type SubmitMemberResearchDelivery = (
  input: RemoteAgentMemberResearchDeliveryInput
) => Promise<{ failureCode?: string; status: "failed" | "submitted" }>;

export async function startCenterAgentMemberResearch(
  env: CoreBindings,
  input: StartCenterAgentMemberResearchRpcInput,
  directMessageSpaceId: string
): Promise<StartCenterAgentMemberResearchResponse> {
  const parsed = startCenterAgentMemberResearchRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid research request.",
      status: 400,
    });
  }
  const request = parsed.data;
  const membership = await resolveActiveOrganizationMembership({
    context: request.context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (membership.organizationId !== request.expectedOrganizationId) {
    throw createCoreRpcHttpError({
      code: "organization.context_mismatch",
      reason: "The active Organization changed. Refresh and try again.",
      status: 409,
    });
  }
  if (request.context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.human_actor_required",
      reason: "Only an Organization member can start member research.",
      status: 403,
    });
  }
  const db = requireResearchDb(env);
  const requester = await readResearchRequester({
    db,
    organizationId: membership.organizationId,
    profileId: request.context.actorContext.openMeldProfileId,
    userId: membership.userId,
  });
  if (!requester) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.human_actor_required",
      reason:
        "Your active human profile is not available in this Organization.",
      status: 403,
    });
  }
  const designation = await readCenterAgentDesignationRecord({
    db,
    organizationId: membership.organizationId,
  });
  if (!designation) {
    throw createCoreRpcHttpError({
      code: "center_agent.designation_required",
      reason: "This Organization has no designated Center Agent.",
      status: 404,
    });
  }
  const activeBatch = await readActiveResearchBatch({
    db,
    organizationId: membership.organizationId,
  });
  if (activeBatch) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.already_running",
      reason: "Member research is already in progress for this Organization.",
      status: 409,
    });
  }
  const subjects = await readResearchSubjects({
    db,
    organizationId: membership.organizationId,
    subjectUserId:
      request.scope === "member" ? request.subjectUserId : undefined,
  });
  if (request.scope === "member" && subjects.length !== 1) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.member_not_found",
      reason: "This member is no longer in the active Organization.",
      status: 404,
    });
  }
  if (subjects.length === 0) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.no_members",
      reason: "This Organization has no human members to research.",
      status: 409,
    });
  }

  const nowMs = Date.now();
  const batchId = crypto.randomUUID();
  const attribution = await resolveCenterAgentAttribution({
    actorProfileId: designation.agentProfileId,
    db,
    onBehalfOfProfileId: requester.profileId,
    organizationId: membership.organizationId,
  });
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `
          INSERT INTO center_agent_member_research_batches (
            id, organization_id, scope, status,
            requested_by_user_id, requested_by_member_id,
            requested_by_profile_id, requested_by_display_name,
            direct_message_space_id, created_at_ms, updated_at_ms
          )
          VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        batchId,
        membership.organizationId,
        request.scope,
        requester.userId,
        requester.memberId,
        requester.profileId,
        requester.displayName,
        directMessageSpaceId,
        nowMs,
        nowMs
      ),
  ];
  subjects.forEach((subject, index) => {
    const taskId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `
            INSERT INTO center_agent_member_research_tasks (
              id, batch_id, subject_user_id, subject_display_name,
              position, status, created_at_ms
            )
            VALUES (?, ?, ?, ?, ?, 'queued', ?)
          `
        )
        .bind(
          taskId,
          batchId,
          subject.userId,
          subject.displayName,
          index + 1,
          nowMs
        ),
      prepareCenterAgentAuditJournalEntryStatement({
        action: "research_member",
        actorProfileId: designation.agentProfileId,
        attribution,
        db,
        id: crypto.randomUUID(),
        nowMs,
        organizationId: membership.organizationId,
        resource: { id: taskId, type: "member_research_task" },
      })
    );
  });
  await db.batch(statements);
  const batch = await readResearchBatchById({ batchId, db });
  if (!batch) {
    throw new Error("Member research acceptance did not persist its batch.");
  }
  return startCenterAgentMemberResearchResponseSchema.parse({ batch });
}

export async function getCenterAgentMemberResearchStatus(
  env: CoreBindings,
  input: GetCenterAgentMemberResearchStatusRpcInput
): Promise<GetCenterAgentMemberResearchStatusResponse> {
  const request = getCenterAgentMemberResearchStatusRpcInputSchema.parse(input);
  const membership = await resolveActiveOrganizationMembership({
    context: request.context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (request.context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.human_actor_required",
      reason: "Only an Organization member can read member research status.",
      status: 403,
    });
  }
  const db = requireResearchDb(env);
  const latest = await db
    .prepare(
      `
        SELECT *
        FROM center_agent_member_research_batches
        WHERE organization_id = ?
        ORDER BY created_at_ms DESC
        LIMIT 1
      `
    )
    .bind(membership.organizationId)
    .first<ResearchBatchRow>();
  return getCenterAgentMemberResearchStatusResponseSchema.parse({
    latestBatch: latest
      ? await readResearchBatchById({ batchId: latest.id, db })
      : null,
    organizationId: membership.organizationId,
  });
}

export async function runCenterAgentMemberResearchTick(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs?: number;
  submitDelivery?: SubmitMemberResearchDelivery;
}): Promise<void> {
  const activeBatches = await input.db
    .prepare(
      `
        SELECT id
        FROM center_agent_member_research_batches
        WHERE status IN ('queued', 'running')
        ORDER BY updated_at_ms ASC
        LIMIT 25
      `
    )
    .all<{ id: string }>();
  for (const row of activeBatches.results) {
    await processResearchBatch({
      ...input,
      batchId: row.id,
      nowMs: input.nowMs ?? Date.now(),
      submitDelivery:
        input.submitDelivery ?? submitRemoteAgentMemberResearchDelivery,
    });
  }
}

type ResearchBatchProcessorInput = {
  batchId: string;
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  submitDelivery: SubmitMemberResearchDelivery;
};

async function processResearchBatch(
  input: ResearchBatchProcessorInput
): Promise<void> {
  const batch = await readStoredResearchBatch({
    batchId: input.batchId,
    db: input.db,
  });
  if (!batch || batch.status === "completed") {
    return;
  }
  const running = await input.db
    .prepare(
      `
        SELECT *
        FROM center_agent_member_research_tasks
        WHERE batch_id = ? AND status = 'running'
        ORDER BY position ASC
        LIMIT 1
      `
    )
    .bind(input.batchId)
    .first<ResearchTaskRow>();
  if (running) {
    await processRunningResearchTask({ ...input, batch, task: running });
    return;
  }

  const next = await input.db
    .prepare(
      `
        SELECT id
        FROM center_agent_member_research_tasks
        WHERE batch_id = ? AND status = 'queued'
        ORDER BY position ASC
        LIMIT 1
      `
    )
    .bind(input.batchId)
    .first<{ id: string }>();
  if (!next) {
    await input.db
      .prepare(
        `
          UPDATE center_agent_member_research_batches
          SET status = 'completed', updated_at_ms = ?
          WHERE id = ?
            AND status IN ('queued', 'running')
            AND NOT EXISTS (
              SELECT 1 FROM center_agent_member_research_tasks
              WHERE batch_id = ? AND status IN ('queued', 'running')
            )
        `
      )
      .bind(input.nowMs, input.batchId, input.batchId)
      .run();
    return;
  }
  const claimed = await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE center_agent_member_research_tasks
          SET status = 'running', started_at_ms = ?
          WHERE id = ?
            AND batch_id = ?
            AND status = 'queued'
            AND NOT EXISTS (
              SELECT 1 FROM center_agent_member_research_tasks
              WHERE batch_id = ? AND status = 'running'
            )
        `
      )
      .bind(input.nowMs, next.id, input.batchId, input.batchId),
    input.db
      .prepare(
        `
          UPDATE center_agent_member_research_batches
          SET status = 'running', updated_at_ms = ?
          WHERE id = ? AND status IN ('queued', 'running')
        `
      )
      .bind(input.nowMs, input.batchId),
  ]);
  if (Number(claimed[0]?.meta?.changes ?? 0) !== 1) {
    return;
  }
  await processResearchBatch(input);
}

async function processRunningResearchTask(
  input: {
    batch: ResearchBatchRow;
    task: ResearchTaskRow;
  } & ResearchBatchProcessorInput
): Promise<void> {
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.task.id,
  });
  if (delivery?.status === "completed") {
    const draftEvidence = await input.db
      .prepare(
        `
          SELECT 1
          FROM organization_documents
          WHERE organization_id = ?
            AND kind = 'member_profile'
            AND subject_user_id = ?
            AND last_member_research_task_id = ?
          LIMIT 1
        `
      )
      .bind(
        input.batch.organization_id,
        input.task.subject_user_id,
        input.task.id
      )
      .first<{ 1: number }>();
    await finishResearchTask({
      db: input.db,
      failureCode: draftEvidence
        ? null
        : "center_agent_member_research.draft_missing",
      nowMs: input.nowMs,
      taskId: input.task.id,
    });
    await processResearchBatch(input);
    return;
  }
  if (
    delivery &&
    delivery.status !== "submitted" &&
    delivery.status !== "accepted" &&
    delivery.status !== "retry_observed"
  ) {
    await finishResearchTask({
      db: input.db,
      failureCode:
        delivery.failureCode ?? "center_agent_member_research.delivery_failed",
      nowMs: input.nowMs,
      taskId: input.task.id,
    });
    await processResearchBatch(input);
    return;
  }
  if (delivery?.submissionId) {
    return;
  }
  if (delivery && delivery.status !== "submitted") {
    return;
  }
  const submission = await input.submitDelivery(
    toDeliveryInput({
      batch: input.batch,
      env: input.env,
      nowMs: input.nowMs,
      task: input.task,
    })
  );
  if (submission.status === "failed") {
    await finishResearchTask({
      db: input.db,
      failureCode:
        submission.failureCode ?? "center_agent_member_research.submit_failed",
      nowMs: input.nowMs,
      taskId: input.task.id,
    });
    await processResearchBatch(input);
  }
}

async function finishResearchTask(input: {
  db: D1Database;
  failureCode: string | null;
  nowMs: number;
  taskId: string;
}): Promise<void> {
  await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE center_agent_member_research_tasks
          SET status = ?, failure_code = ?, finished_at_ms = ?
          WHERE id = ? AND status = 'running'
        `
      )
      .bind(
        input.failureCode ? "failed" : "completed",
        input.failureCode,
        input.nowMs,
        input.taskId
      ),
    input.db
      .prepare(
        `
          UPDATE center_agent_member_research_batches
          SET updated_at_ms = ?
          WHERE id = (
            SELECT batch_id FROM center_agent_member_research_tasks WHERE id = ?
          )
        `
      )
      .bind(input.nowMs, input.taskId),
  ]);
}

function toDeliveryInput(input: {
  batch: ResearchBatchRow;
  env: CoreBindings;
  nowMs: number;
  task: ResearchTaskRow;
}): RemoteAgentMemberResearchDeliveryInput {
  return {
    db: requireResearchDb(input.env),
    directMessageSpaceId: input.batch.direct_message_space_id,
    env: input.env,
    nowMs: input.nowMs,
    organizationId: input.batch.organization_id,
    requesterUserId: input.batch.requested_by_user_id,
    subjectDisplayName: input.task.subject_display_name,
    subjectUserId: input.task.subject_user_id,
    taskId: input.task.id,
  };
}

function requireResearchDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.store_unavailable",
      reason: "Member research is temporarily unavailable.",
      status: 503,
    });
  }
  return db;
}
