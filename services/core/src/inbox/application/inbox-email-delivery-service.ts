import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
import { authRpcSendInboxUrgentEmailResultSchema } from "@openmeld/schemas";
import type {
  AuthRpcSendInboxUrgentEmailInput,
  AuthRpcSendInboxUrgentEmailResult,
} from "@openmeld/schemas/types";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";

const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 100;
const CLAIM_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
type DeliveryCandidateRow = {
  id: string;
};
type ClaimedDeliveryRow = {
  attempt_count: number;
  attention: "action_required" | "update";
  cleared_at_ms: number | null;
  delivery_id: string;
  importance: "normal" | "urgent";
  item_id: string;
  organization_id: string;
  preview: string;
  recipient_user_id: string;
  resolution_status: "not_applicable" | "open" | "resolved";
  source_accessible: number;
  source_target_kind: string;
  invitation_request_id: string | null;
  title: string;
  urgent_email_enabled: number;
  requires_organization_manager?: number;
};
export type SendInboxUrgentEmail = (
  input: AuthRpcSendInboxUrgentEmailInput
) => Promise<AuthRpcSendInboxUrgentEmailResult>;
export type ResolveInboxOrganizationAccess = (input: {
  organizationId: string;
  recipientUserId: string;
  requireOrganizationManager?: boolean;
}) => Promise<"allowed" | "denied" | "unavailable">;
export type InboxEmailDeliveryTickResult = {
  attempted: number;
  failed: number;
  sent: number;
  suppressed: number;
};
export async function retryInboxUrgentEmailDeliveries(input: {
  db: PostgresDatabase;
  nowMs: number;
  resolveOrganizationAccess: ResolveInboxOrganizationAccess;
  send: SendInboxUrgentEmail;
  limit?: number;
  createClaimId?: () => string;
}): Promise<InboxEmailDeliveryTickResult> {
  assertTimestamp(input.nowMs);
  const limit = normalizeLimit(input.limit);
  const candidates = await input.db.query<DeliveryCandidateRow>({
    text: `
        SELECT id
        FROM "openmeld"."inbox_email_deliveries"
        WHERE next_attempt_at_ms <= $1
          AND (
            state = 'pending'
            OR (
              state = 'sending'
              AND claim_expires_at_ms IS NOT NULL
              AND claim_expires_at_ms <= $2
            )
          )
        ORDER BY next_attempt_at_ms ASC NULLS FIRST, id ASC NULLS FIRST
        LIMIT $3
      `,
    values: [input.nowMs, input.nowMs, limit],
  });
  const result: InboxEmailDeliveryTickResult = {
    attempted: 0,
    failed: 0,
    sent: 0,
    suppressed: 0,
  };
  for (const candidate of candidates.rows ?? []) {
    const claimId =
      input.createClaimId?.() ?? `inbox_email_claim_${crypto.randomUUID()}`;
    const claimed = await claimDelivery({
      claimId,
      db: input.db,
      deliveryId: candidate.id,
      nowMs: input.nowMs,
    });
    if (!claimed) {
      continue;
    }
    result.attempted += 1;
    const organizationAccess = await resolveOrganizationAccess({
      claimed,
      resolve: input.resolveOrganizationAccess,
    });
    if (organizationAccess === "unavailable") {
      await recordDeliveryFailure({
        attemptCount: claimed.attempt_count,
        claimId,
        code: "organization_access_unavailable",
        db: input.db,
        deliveryId: claimed.delivery_id,
        nowMs: input.nowMs,
        retryable: true,
      });
      result.failed += 1;
      continue;
    }
    const suppressionReason = resolveSuppressionReason({
      organizationAccess,
      row: claimed,
    });
    if (suppressionReason) {
      await suppressDelivery({
        claimId,
        db: input.db,
        deliveryId: claimed.delivery_id,
        nowMs: input.nowMs,
        reason: suppressionReason,
      });
      result.suppressed += 1;
      continue;
    }
    const outcome = await sendUrgentEmail({
      claimed,
      send: input.send,
    });
    if (outcome.status === "sent") {
      await markDeliverySent({
        claimId,
        db: input.db,
        deliveryId: claimed.delivery_id,
        messageId: outcome.messageId,
        nowMs: input.nowMs,
      });
      result.sent += 1;
      continue;
    }
    if (outcome.status === "suppressed") {
      await suppressDelivery({
        claimId,
        db: input.db,
        deliveryId: claimed.delivery_id,
        nowMs: input.nowMs,
        reason: outcome.reason,
      });
      result.suppressed += 1;
      continue;
    }
    await recordDeliveryFailure({
      attemptCount: claimed.attempt_count,
      claimId,
      code: outcome.code,
      db: input.db,
      deliveryId: claimed.delivery_id,
      nowMs: input.nowMs,
      retryable: outcome.retryable,
    });
    result.failed += 1;
  }
  return result;
}
async function claimDelivery(input: {
  claimId: string;
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
}): Promise<ClaimedDeliveryRow | null> {
  const claimExpiresAtMs = input.nowMs + CLAIM_TTL_MS;
  const update = await input.db.query({
    text: `
        UPDATE "openmeld"."inbox_email_deliveries"
        SET
          state = 'sending',
          attempt_count = attempt_count + 1,
          claim_id = $1,
          claim_expires_at_ms = $2,
          updated_at_ms = GREATEST(updated_at_ms, $3)
        WHERE id = $4
          AND next_attempt_at_ms <= $5
          AND (
            state = 'pending'
            OR (
              state = 'sending'
              AND claim_expires_at_ms IS NOT NULL
              AND claim_expires_at_ms <= $6
            )
          )
      `,
    values: [
      input.claimId,
      claimExpiresAtMs,
      input.nowMs,
      input.deliveryId,
      input.nowMs,
      input.nowMs,
    ],
  });
  if (changedRows(update) === 0) {
    return null;
  }
  const claimed = await input.db
    .query<ClaimedDeliveryRow>({
      text: `
        SELECT
          deliveries.id AS delivery_id,
          deliveries.attempt_count,
          items.id AS item_id,
          items.organization_id,
          items.recipient_user_id,
          items.attention,
          items.importance,
          ((items.source_target_json)::jsonb #>> '{kind}') AS source_target_kind,
          ((items.source_target_json)::jsonb #>> '{requestId}') AS invitation_request_id,
          items.title,
          items.preview,
          items.resolution_status,
          items.cleared_at_ms,
          CASE WHEN items.source_kind = 'system_attention_event' AND items.source_key ILIKE 'authorization-update:%' THEN 1 ELSE 0 END AS requires_organization_manager,
          CASE WHEN ${buildCurrentInboxSourceAccessSql("items", true)}
            THEN 1 ELSE 0 END AS source_accessible,
          coalesce(preferences.urgent_email_enabled, 1) AS urgent_email_enabled
        FROM "openmeld"."inbox_email_deliveries" AS deliveries
        INNER JOIN "openmeld"."inbox_items" AS items
          ON items.id = deliveries.inbox_item_id
        LEFT JOIN "openmeld"."inbox_notification_preferences" AS preferences
          ON preferences.user_id = items.recipient_user_id
        WHERE deliveries.id = $1
          AND deliveries.state = 'sending'
          AND deliveries.claim_id = $2
        LIMIT 1
      `,
      values: [input.deliveryId, input.claimId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!claimed) {
    throw new Error("Claimed Inbox email delivery could not be read");
  }
  return claimed;
}
async function resolveOrganizationAccess(input: {
  claimed: ClaimedDeliveryRow;
  resolve: ResolveInboxOrganizationAccess;
}): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    return await input.resolve({
      organizationId: input.claimed.organization_id,
      recipientUserId: input.claimed.recipient_user_id,
      ...(input.claimed.requires_organization_manager === 1
        ? { requireOrganizationManager: true }
        : {}),
    });
  } catch (error) {
    console.error("[core.inbox.email.organization_access_failed]", {
      deliveryId: input.claimed.delivery_id,
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.claimed.organization_id,
      recipientUserId: input.claimed.recipient_user_id,
    });
    return "unavailable";
  }
}
function resolveSuppressionReason(input: {
  organizationAccess: "allowed" | "denied";
  row: ClaimedDeliveryRow;
}): string | null {
  if (input.organizationAccess === "denied") {
    return "source_access_revoked";
  }
  const { row } = input;
  if (row.source_accessible !== 1) {
    return "source_access_revoked";
  }
  if (
    row.source_target_kind !== "organization_join_request" &&
    row.urgent_email_enabled !== 1
  ) {
    return "preference_disabled";
  }
  if (row.cleared_at_ms !== null) {
    return "item_cleared";
  }
  if (
    row.source_target_kind !== "organization_join_request" &&
    row.importance !== "urgent"
  ) {
    return "item_not_urgent";
  }
  if (row.attention === "action_required" && row.resolution_status !== "open") {
    return "source_resolved";
  }
  return null;
}
async function sendUrgentEmail(input: {
  claimed: ClaimedDeliveryRow;
  send: SendInboxUrgentEmail;
}): Promise<AuthRpcSendInboxUrgentEmailResult> {
  try {
    const raw = await input.send({
      ...(input.claimed.source_target_kind === "organization_join_request"
        ? {
            purpose: "invitation_review" as const,
            invitationRequestId:
              input.claimed.invitation_request_id ?? undefined,
          }
        : {}),
      deliveryId: input.claimed.delivery_id,
      itemId: input.claimed.item_id,
      organizationId: input.claimed.organization_id,
      preview: input.claimed.preview,
      title: input.claimed.title,
      userId: input.claimed.recipient_user_id,
    });
    const parsed = authRpcSendInboxUrgentEmailResultSchema.safeParse(raw);
    if (
      parsed.success &&
      parsed.data.deliveryId === input.claimed.delivery_id
    ) {
      return parsed.data;
    }
  } catch (error) {
    console.error("[core.inbox.email.auth_rpc_failed]", {
      deliveryId: input.claimed.delivery_id,
      error: error instanceof Error ? error.message : String(error),
      itemId: input.claimed.item_id,
      organizationId: input.claimed.organization_id,
    });
  }
  return {
    code: "email_send_transient",
    deliveryId: input.claimed.delivery_id,
    retryable: true,
    status: "failed",
  };
}
async function markDeliverySent(input: {
  claimId: string;
  db: PostgresDatabase;
  deliveryId: string;
  messageId: string;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."inbox_email_deliveries"
        SET
          state = 'sent',
          message_id = $1,
          sent_at_ms = $2,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = GREATEST(updated_at_ms, $3)
        WHERE id = $4
          AND state = 'sending'
          AND claim_id = $5
      `,
    values: [
      input.messageId,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.claimId,
    ],
  });
}
async function suppressDelivery(input: {
  claimId: string;
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
  reason: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."inbox_email_deliveries"
        SET
          state = 'suppressed',
          suppressed_reason = $1,
          suppressed_at_ms = $2,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = GREATEST(updated_at_ms, $3)
        WHERE id = $4
          AND state = 'sending'
          AND claim_id = $5
      `,
    values: [
      input.reason,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.claimId,
    ],
  });
}
async function recordDeliveryFailure(input: {
  attemptCount: number;
  claimId: string;
  code: string;
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
  retryable: boolean;
}): Promise<void> {
  const retryable = input.retryable && input.attemptCount < MAX_ATTEMPTS;
  const backoffMs = retryable
    ? (RETRY_BACKOFF_MS[input.attemptCount - 1] ??
      RETRY_BACKOFF_MS.at(-1) ??
      60_000)
    : 0;
  await input.db.query({
    text: `
        UPDATE "openmeld"."inbox_email_deliveries"
        SET
          state = $1,
          next_attempt_at_ms = $2,
          last_error_code = $3,
          last_error_retryable = $4,
          failed_at_ms = $5,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = GREATEST(updated_at_ms, $6)
        WHERE id = $7
          AND state = 'sending'
          AND claim_id = $8
      `,
    values: [
      retryable ? "pending" : "failed",
      input.nowMs + backoffMs,
      input.code,
      input.retryable ? 1 : 0,
      retryable ? null : input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.claimId,
    ],
  });
}
function normalizeLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_BATCH_LIMIT;
  if (
    !(Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_BATCH_LIMIT)
  ) {
    throw new TypeError("Inbox email batch limit is invalid");
  }
  return limit;
}
function assertTimestamp(value: number): void {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError("Inbox email tick timestamp is invalid");
  }
}
function changedRows(result: QueryResult<Record<string, unknown>>): number {
  return Math.max(0, Math.trunc(Number(result.rowCount ?? 0)));
}
