import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  CREDENTIAL_CONFIRMATION_TTL_MS,
  type CredentialConfirmationDecision,
  type CredentialConfirmationView,
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_PREVIEW_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
  type SensitiveOperation,
} from "@openmeld/schemas";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import {
  asQueryable,
  type CredentialConfirmationRecord,
  consumeCredentialConfirmation,
  decideCredentialConfirmationRecord,
  expireCredentialConfirmations,
  insertCredentialConfirmation,
  readLiveCredentialConfirmation,
  readOwnedCredentialConfirmation,
  readProfileNames,
} from "../infrastructure/postgresql/sensitive-operation-repo";

const SOURCE_KIND = "credential_confirmation" as const;

const OPERATION_PHRASES: Record<SensitiveOperation, string> = {
  agent_access_decision: "answer an Agent access request",
  agent_access_grant_revoke: "revoke Agent access",
  agent_interaction_answer: "answer an Agent's approval request",
  binding_collaboration_mode: "change an Agent's collaboration mode",
  binding_disable: "disconnect an Agent",
  binding_ensure: "connect an Agent",
  binding_model_selection: "change an Agent's model",
  binding_opencode_permission: "change an Agent's OpenCode permission",
  binding_permission_mode: "change an Agent's permission mode",
  creation_defaults_write: "change defaults for new Agents",
  default_project_write: "change an Agent's default Project",
  execution_mode_write: "change how many tasks an Agent runs at once",
  profile_delete: "delete an Agent Profile",
  session_archive: "archive a chat with an Agent",
  session_delete: "delete a chat with an Agent",
  runtime_settings_write: "change an Agent's settings",
  space_delete: "delete a Space",
  space_members_add_agent: "add an Agent to a Space",
  work_recovery: "approve or skip an Agent's queued work",
  working_folder_write: "change an Agent's working folder",
};

export function buildCredentialConfirmationInboxSourceKey(
  confirmationId: string
): string {
  return `credential-confirmation:${confirmationId}`;
}

export type CredentialConfirmationOutcome =
  | { status: "approved"; confirmationId: string }
  | { status: "declined"; confirmationId: string }
  | { status: "pending"; confirmationId: string };

/**
 * The owner's answer for one sensitive request made with the CLI credential
 * inside the risk window. The binding is the request digest: repeating the
 * same request after approval uses the approval once.
 */
export async function resolveCredentialConfirmation(input: {
  agentProfileId: string | null;
  blockingRootProfileId: string | null;
  clientConfirmationId: string | null;
  db: PostgresDatabase;
  nowMs: number;
  operation: SensitiveOperation;
  organizationId: string;
  ownerUserId: string;
  requestDigest: string;
}): Promise<CredentialConfirmationOutcome> {
  const db = asQueryable(input.db);
  const binding = {
    db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    requestDigest: input.requestDigest,
  };
  for (const expired of await expireCredentialConfirmations(binding)) {
    await resolveCredentialConfirmationInboxItem({
      db: input.db,
      nowMs: input.nowMs,
      record: expired,
    });
  }
  const live = await readLiveCredentialConfirmation(binding);
  if (live?.status === "approved") {
    if (
      await consumeCredentialConfirmation({
        db,
        id: live.id,
        nowMs: input.nowMs,
      })
    ) {
      return { confirmationId: live.id, status: "approved" };
    }
    // Another call used it first; this one needs its own answer.
  } else if (live?.status === "declined") {
    return { confirmationId: live.id, status: "declined" };
  } else if (live?.status === "pending") {
    return { confirmationId: live.id, status: "pending" };
  }
  const record = {
    agentProfileId: input.agentProfileId,
    blockingRootProfileId: input.blockingRootProfileId,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + CREDENTIAL_CONFIRMATION_TTL_MS,
    operation: input.operation,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    requestDigest: input.requestDigest,
  };
  // The client's handle lets it poll; a taken handle gets a fresh id.
  const created =
    (input.clientConfirmationId
      ? await insertCredentialConfirmation({
          db,
          record: { ...record, id: input.clientConfirmationId },
        })
      : null) ??
    (await insertCredentialConfirmation({
      db,
      record: { ...record, id: crypto.randomUUID() },
    }));
  if (!created) {
    throw new Error("credential_confirmation.insert_failed");
  }
  await projectCredentialConfirmationInboxItem({
    db: input.db,
    nowMs: input.nowMs,
    record: created,
  });
  return { confirmationId: created.id, status: "pending" };
}

/** The owner's urgent Inbox item. Fixed copy: names only, never inputs. */
async function projectCredentialConfirmationInboxItem(input: {
  db: PostgresDatabase;
  nowMs: number;
  record: CredentialConfirmationRecord;
}): Promise<void> {
  const { record } = input;
  const names = await readProfileNames({
    db: asQueryable(input.db),
    profileIds: [record.agentProfileId, record.blockingRootProfileId].filter(
      (id): id is string => id !== null
    ),
  });
  const agentName = record.agentProfileId
    ? (names.get(record.agentProfileId) ?? null)
    : null;
  const requesterName = record.blockingRootProfileId
    ? (names.get(record.blockingRootProfileId) ?? null)
    : null;
  const phrase = OPERATION_PHRASES[record.operation];
  const candidate: InboxSourceCandidate = {
    attention: "action_required",
    contextLabel: agentName
      ? truncateInboxText(agentName, INBOX_CONTEXT_LABEL_MAX_CHARS)
      : null,
    importance: "urgent",
    kind: "credential_confirmation",
    occurredAtMs: record.createdAtMs,
    organizationId: record.organizationId,
    preview: truncateInboxText(
      `A command on your computer used your OpenMeld sign-in to ${phrase} while ${
        requesterName
          ? `a task for ${requesterName}`
          : "a task for someone else"
      } was running there. Confirm only if you ran it. Nothing changes until you choose.`,
      INBOX_PREVIEW_MAX_CHARS
    ),
    recipientUserId: record.ownerUserId,
    sourceFacts: {
      version: 1,
      ...(record.agentProfileId
        ? {
            agentProfileIds: [record.agentProfileId],
            personalAgentProfileIds: [record.agentProfileId],
          }
        : {}),
      recipientReasons: ["agent_owner"],
      requestCategory: "action",
    },
    sourceKey: buildCredentialConfirmationInboxSourceKey(record.id),
    sourceKind: SOURCE_KIND,
    sourceTarget: {
      kind: "credential_confirmation",
      confirmationId: record.id,
    },
    title: truncateInboxText(
      `Confirm: ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`,
      INBOX_TITLE_MAX_CHARS
    ),
  };
  await ensureInboxItem({ candidate, db: input.db, nowMs: input.nowMs });
}

async function resolveCredentialConfirmationInboxItem(input: {
  db: PostgresDatabase;
  nowMs: number;
  record: Pick<CredentialConfirmationRecord, "id" | "organizationId">;
}): Promise<void> {
  await resolveInboxItemsBySource({
    db: input.db,
    organizationId: input.record.organizationId,
    resolvedAtMs: input.nowMs,
    sourceKey: buildCredentialConfirmationInboxSourceKey(input.record.id),
    sourceKind: SOURCE_KIND,
  });
}

export async function readCredentialConfirmationView(input: {
  confirmationId: string;
  db: PostgresDatabase;
  nowMs: number;
  ownerUserId: string;
}): Promise<CredentialConfirmationView | null> {
  const record = await readOwnedCredentialConfirmation({
    db: asQueryable(input.db),
    id: input.confirmationId,
    ownerUserId: input.ownerUserId,
  });
  if (!record) {
    return null;
  }
  const timedOut =
    (record.status === "pending" || record.status === "approved") &&
    record.expiresAtMs <= input.nowMs;
  return {
    agentProfileId: record.agentProfileId,
    agentProfileName: record.agentProfileName,
    createdAtMs: record.createdAtMs,
    decidedAtMs: record.decidedAtMs,
    expiresAtMs: record.expiresAtMs,
    id: record.id,
    operation: record.operation,
    status: timedOut ? "expired" : record.status,
  };
}

export type CredentialConfirmationDecisionResult =
  | { status: "decided"; view: CredentialConfirmationView }
  | { status: "not_found" }
  | { status: "closed"; view: CredentialConfirmationView };

/** Only the owner decides, once, from pending. The same answer is idempotent. */
export async function decideCredentialConfirmation(input: {
  confirmationId: string;
  db: PostgresDatabase;
  decision: CredentialConfirmationDecision;
  nowMs: number;
  ownerUserId: string;
}): Promise<CredentialConfirmationDecisionResult> {
  const status = input.decision === "approve" ? "approved" : "declined";
  const decided = await decideCredentialConfirmationRecord({
    db: asQueryable(input.db),
    id: input.confirmationId,
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    status,
  });
  if (decided) {
    await resolveCredentialConfirmationInboxItem({
      db: input.db,
      nowMs: input.nowMs,
      record: decided,
    });
  }
  const view = await readCredentialConfirmationView(input);
  if (!view) {
    return { status: "not_found" };
  }
  if (decided || view.status === status) {
    return { status: "decided", view };
  }
  if (status === "approved" && view.status === "consumed") {
    return { status: "decided", view };
  }
  return { status: "closed", view };
}
