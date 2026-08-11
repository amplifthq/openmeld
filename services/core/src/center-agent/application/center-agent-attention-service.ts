import { centerAgentRequestMemberAttentionBodySchema } from "@openmeld/schemas";
import type {
  CenterAgentAttentionImpact,
  InboxImportance,
  InboxSourceTarget,
} from "@openmeld/schemas/types";
import {
  prepareEnsureInboxItemStatements,
  prepareResolveInboxItemsBySourceStatements,
} from "../../inbox/application/inbox-item-service";

const SOURCE_KIND = "remote_agent_native_interaction" as const;

type CenterAgentAttentionRequestInput = {
  db: D1Database;
  impact: CenterAgentAttentionImpact;
  nativeDeliveryId: string;
  nowMs: number;
  organizationId: string;
  prompt: string;
  recipientUserId: string;
  sourceTarget: InboxSourceTarget;
  spaceId: string;
  submissionId: string;
  title: string;
  triggerSignalId: string;
};

export async function createCenterAgentAttentionRequest(
  input: CenterAgentAttentionRequestInput
): Promise<{ importance: InboxImportance; requestId: string }> {
  const request = centerAgentRequestMemberAttentionBodySchema.parse({
    impact: input.impact,
    prompt: input.prompt,
    submissionId: input.submissionId,
    title: input.title,
  });
  assertIdentifier(input.nativeDeliveryId, "nativeDeliveryId");
  assertIdentifier(input.organizationId, "organizationId");
  assertIdentifier(input.recipientUserId, "recipientUserId");
  assertIdentifier(input.spaceId, "spaceId");
  assertIdentifier(input.triggerSignalId, "triggerSignalId");
  assertTimestamp(input.nowMs, "nowMs");
  const existing = await readAttentionRequest(input.db, request.submissionId);
  if (existing) {
    assertSameRequest(existing, input);
    return {
      importance: importanceForImpact(request.impact),
      requestId: existing.id,
    };
  }

  const importance = importanceForImpact(request.impact);
  const candidate = {
    attention: "action_required" as const,
    contextLabel: "Center Agent",
    importance,
    kind: "agent_interaction" as const,
    occurredAtMs: input.nowMs,
    organizationId: input.organizationId,
    preview: request.prompt,
    recipientUserId: input.recipientUserId,
    sourceKey: request.submissionId,
    sourceKind: SOURCE_KIND,
    sourceTarget: input.sourceTarget,
    title: request.title,
  };
  const preparedInbox = await prepareEnsureInboxItemStatements({
    candidate,
    db: input.db,
    nowMs: input.nowMs,
  });
  const sourceInsert = input.db
    .prepare(
      `
        INSERT INTO center_agent_attention_requests (
          id,
          organization_id,
          recipient_user_id,
          space_id,
          trigger_signal_id,
          source_native_delivery_id,
          submission_id,
          impact,
          title,
          prompt,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `
    )
    .bind(
      request.submissionId,
      input.organizationId,
      input.recipientUserId,
      input.spaceId,
      input.triggerSignalId,
      input.nativeDeliveryId,
      request.submissionId,
      request.impact,
      request.title,
      request.prompt,
      input.nowMs,
      input.nowMs
    );
  try {
    await input.db.batch([sourceInsert, ...preparedInbox.statements]);
  } catch (error) {
    const raced = await readAttentionRequest(input.db, request.submissionId);
    if (raced) {
      assertSameRequest(raced, input);
      return { importance, requestId: raced.id };
    }
    throw error;
  }
  return { importance, requestId: request.submissionId };
}

export async function resolveCenterAgentAttentionRequestsForReply(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  recipientUserId: string;
  spaceId: string;
}): Promise<number> {
  assertTimestamp(input.nowMs, "nowMs");
  const open = await input.db
    .prepare(
      `
        SELECT submission_id
        FROM center_agent_attention_requests
        WHERE organization_id = ?
          AND recipient_user_id = ?
          AND space_id = ?
          AND status = 'open'
        ORDER BY created_at_ms, submission_id
      `
    )
    .bind(input.organizationId, input.recipientUserId, input.spaceId)
    .all<{ submission_id: string }>();
  const sourceKeys = (open.results ?? []).map((row) => row.submission_id);
  if (sourceKeys.length === 0) {
    return 0;
  }
  const placeholders = sourceKeys.map(() => "?").join(", ");
  const sourceUpdate = input.db
    .prepare(
      `
        UPDATE center_agent_attention_requests
        SET
          status = 'resolved',
          resolved_at_ms = ?,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE organization_id = ?
          AND recipient_user_id = ?
          AND space_id = ?
          AND status = 'open'
          AND submission_id IN (${placeholders})
      `
    )
    .bind(
      input.nowMs,
      input.nowMs,
      input.organizationId,
      input.recipientUserId,
      input.spaceId,
      ...sourceKeys
    );
  const inboxStatements = sourceKeys.flatMap((sourceKey) =>
    prepareResolveInboxItemsBySourceStatements({
      db: input.db,
      organizationId: input.organizationId,
      resolvedAtMs: input.nowMs,
      sourceKey,
      sourceKind: SOURCE_KIND,
    })
  );
  const [result] = await input.db.batch([sourceUpdate, ...inboxStatements]);
  return Math.max(0, Math.trunc(Number(result?.meta.changes ?? 0)));
}

type AttentionRequestRow = {
  id: string;
  impact: CenterAgentAttentionImpact;
  native_delivery_id: string;
  organization_id: string;
  prompt: string;
  recipient_user_id: string;
  space_id: string;
  title: string;
  trigger_signal_id: string;
};

async function readAttentionRequest(
  db: D1Database,
  submissionId: string
): Promise<AttentionRequestRow | null> {
  return await db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          recipient_user_id,
          space_id,
          trigger_signal_id,
          source_native_delivery_id AS native_delivery_id,
          impact,
          title,
          prompt
        FROM center_agent_attention_requests
        WHERE submission_id = ?
        LIMIT 1
      `
    )
    .bind(submissionId)
    .first<AttentionRequestRow>();
}

function assertSameRequest(
  existing: AttentionRequestRow,
  input: CenterAgentAttentionRequestInput
): void {
  if (
    existing.organization_id === input.organizationId &&
    existing.recipient_user_id === input.recipientUserId &&
    existing.space_id === input.spaceId &&
    existing.trigger_signal_id === input.triggerSignalId &&
    existing.native_delivery_id === input.nativeDeliveryId &&
    existing.impact === input.impact &&
    existing.title === input.title &&
    existing.prompt === input.prompt
  ) {
    return;
  }
  throw new Error(
    "Center Agent attention request conflicts with an existing submission."
  );
}

function importanceForImpact(
  impact: CenterAgentAttentionImpact
): InboxImportance {
  return impact === "response_needed" ? "normal" : "urgent";
}

function assertIdentifier(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`${field} is required`);
  }
}

function assertTimestamp(value: number, field: string): void {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}
