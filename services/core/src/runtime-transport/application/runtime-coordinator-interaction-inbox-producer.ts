import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_PREVIEW_MAX_CHARS,
  readRuntimeCoordinatorExecutionIdParts,
} from "@openmeld/schemas";
import type {
  AgentInteractionRequest,
  InboxSourceCandidate,
} from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  reopenCoalescedInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import { isMemberAgentsEnabled } from "../../member-agent/member-agents-feature";
import {
  hasActiveOwnedAgentMembership,
  readHumanSpaceMembershipAccessForOwner,
  readSpaceIndexOrganizationJoinTarget,
} from "../../space-index/space-index-repository";

const RUNTIME_COORDINATOR_INTERACTION_SOURCE_KIND =
  "runtime_coordinator_interaction" as const;
type RuntimeCoordinatorInteractionInboxSource = {
  interaction: Pick<
    AgentInteractionRequest,
    "interactionId" | "kind" | "requestedAtMs"
  >;
  ownerUserId: string;
  runtimeCoordinatorExecutionId: string;
  sourceSignalId: string;
  spaceId: string;
  targetProfileName: string;
  /**
   * Explicit null means the Space main timeline. Undefined is reserved for
   * repair records written before the thread locator was projected.
   */
  threadRootSignalId?: string | null;
  /**
   * The Wake's request chain root and Session, once the chain is enforced.
   * Absent: owner-rooted legacy, one normal item per question.
   */
  requestRoot?: InteractionRequestRoot | null;
};
export type InteractionRequestRoot = {
  /** The Session; null for a harness without Execution Contexts. */
  contextId: string | null;
  rootProfileId: string;
};
export async function projectRuntimeCoordinatorInteractionInboxItem(
  input: RuntimeCoordinatorInteractionInboxSource & {
    inboxDb: PostgresDatabase;
    nowMs: number;
    spaceIndexDb: PostgresDatabase;
  }
): Promise<{ organizationId: string } | null> {
  const target = await readSpaceIndexOrganizationJoinTarget({
    db: input.spaceIndexDb,
    spaceId: input.spaceId,
  });
  if (!target) {
    throw new Error("runtime_coordinator.interaction_inbox.space_unavailable");
  }
  const recipientAccess = await readRecipientAccess({
    db: input.spaceIndexDb,
    organizationId: target.organizationId,
    ownerUserId: input.ownerUserId,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    spaceId: input.spaceId,
  });
  if (recipientAccess.kind === "removed") {
    return null;
  }
  if (recipientAccess.kind === "missing") {
    throw new Error(
      "runtime_coordinator.interaction_inbox.membership_projection_unavailable"
    );
  }
  const presentation = resolveInteractionPresentation({
    kind: input.interaction.kind,
    targetProfileName: input.targetProfileName,
  });
  // Only the owner answers. When someone else is the root requester the
  // owner is asked urgently, once per Session (inbox.md, Agent owner requests).
  const urgentSession =
    input.requestRoot &&
    !(await isRootRequesterOwnedBy({
      db: input.inboxDb,
      ownerUserId: input.ownerUserId,
      rootProfileId: input.requestRoot.rootProfileId,
    }))
      ? input.requestRoot
      : null;
  const candidate: InboxSourceCandidate = {
    attention: "action_required",
    contextLabel: truncateInboxText(
      input.targetProfileName,
      INBOX_CONTEXT_LABEL_MAX_CHARS
    ),
    importance: urgentSession ? "urgent" : "normal",
    kind: "agent_interaction",
    occurredAtMs: input.interaction.requestedAtMs,
    organizationId: target.organizationId,
    // Fixed copy: never the command, path, or question text.
    preview: truncateInboxText(presentation.preview, INBOX_PREVIEW_MAX_CHARS),
    recipientUserId: input.ownerUserId,
    sourceKey: urgentSession
      ? await buildRuntimeCoordinatorSessionInboxSourceKey({
          ...input,
          requestRoot: urgentSession,
        })
      : await buildRuntimeCoordinatorInteractionInboxSourceKey(input),
    sourceKind: RUNTIME_COORDINATOR_INTERACTION_SOURCE_KIND,
    sourceFacts: {
      version: 1,
      ...(recipientAccess.kind === "observer"
        ? {
            agentProfileIds: [recipientAccess.agentProfileId],
            personalAgentProfileIds: [recipientAccess.agentProfileId],
          }
        : {}),
      recipientReasons:
        recipientAccess.kind === "observer" ? ["agent_owner"] : ["requester"],
      // Only the Binding owner can answer, and the Agent waits until they
      // do, so every kind needs their action (member-agent-program.md §4.6).
      requestCategory: "action",
    },
    sourceTarget: {
      ...(recipientAccess.kind === "observer"
        ? { agentOwnerActivity: true }
        : {}),
      interactionId: input.interaction.interactionId,
      kind: "agent_interaction",
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      sourceSignalId: input.sourceSignalId,
      spaceId: input.spaceId,
      ...(input.threadRootSignalId === undefined
        ? {}
        : { threadRootSignalId: input.threadRootSignalId }),
    },
    title: presentation.title,
  };
  if (urgentSession) {
    // Later questions in this Session update and reopen the same item; its
    // one email was created with the first question.
    await reopenCoalescedInboxItem({
      candidate,
      db: input.inboxDb,
      nowMs: input.nowMs,
    });
    return { organizationId: target.organizationId };
  }
  await ensureInboxItem({
    allowLegacySourceClassificationRepair: true,
    candidate,
    db: input.inboxDb,
    nowMs: input.nowMs,
  });
  return { organizationId: target.organizationId };
}
/**
 * The Binding owner answers questions from their own Agent. A member gets
 * the item; so does an owner who only observes the Space through this Agent
 * (member-agent-program.md §4.6). The observer's item names the Agent so
 * Inbox reads and email admit it the way they admit owner activity.
 */
async function readRecipientAccess(input: {
  db: PostgresDatabase;
  organizationId: string;
  ownerUserId: string;
  runtimeCoordinatorExecutionId: string;
  spaceId: string;
}): Promise<
  | { kind: "member" }
  | { kind: "observer"; agentProfileId: string }
  | { kind: "missing" | "removed" }
> {
  const humanAccess = await readHumanSpaceMembershipAccessForOwner(input);
  if (humanAccess === "active") {
    return { kind: "member" };
  }
  const agentProfileId = readRuntimeCoordinatorExecutionIdParts(
    input.runtimeCoordinatorExecutionId
  )?.targetProfileId;
  if (
    isMemberAgentsEnabled() &&
    agentProfileId &&
    (await hasActiveOwnedAgentMembership({ ...input, agentProfileId }))
  ) {
    return { kind: "observer", agentProfileId };
  }
  return { kind: humanAccess };
}
export async function resolveRuntimeCoordinatorInteractionInboxItem(
  input: Pick<
    RuntimeCoordinatorInteractionInboxSource,
    | "interaction"
    | "ownerUserId"
    | "requestRoot"
    | "runtimeCoordinatorExecutionId"
    | "spaceId"
  > & {
    inboxDb: PostgresDatabase;
    resolvedAtMs: number;
    spaceIndexDb: PostgresDatabase;
  }
): Promise<{ organizationId: string }> {
  const target = await readSpaceIndexOrganizationJoinTarget({
    db: input.spaceIndexDb,
    spaceId: input.spaceId,
  });
  if (!target) {
    throw new Error("runtime_coordinator.interaction_inbox.space_unavailable");
  }
  await resolveInboxItemsBySource({
    db: input.inboxDb,
    organizationId: target.organizationId,
    resolvedAtMs: input.resolvedAtMs,
    sourceKey: await buildRuntimeCoordinatorInteractionInboxSourceKey(input),
    sourceKind: RUNTIME_COORDINATOR_INTERACTION_SOURCE_KIND,
  });
  if (!input.requestRoot) {
    return { organizationId: target.organizationId };
  }
  // The Session item closes only for the question it currently shows; a
  // newer question in the same Session keeps it open.
  await resolveInboxItemsBySource({
    db: input.inboxDb,
    organizationId: target.organizationId,
    resolvedAtMs: input.resolvedAtMs,
    sourceGuard: {
      bindings: [
        input.interaction.interactionId,
        input.runtimeCoordinatorExecutionId,
      ],
      sql: (offset) =>
        `((source_target_json)::jsonb ->> 'interactionId') = $${offset + 1}
          AND ((source_target_json)::jsonb ->> 'runtimeCoordinatorExecutionId') = $${offset + 2}`,
    },
    sourceKey: await buildRuntimeCoordinatorSessionInboxSourceKey({
      ...input,
      requestRoot: input.requestRoot,
    }),
    sourceKind: RUNTIME_COORDINATOR_INTERACTION_SOURCE_KIND,
  });
  return { organizationId: target.organizationId };
}
async function isRootRequesterOwnedBy(input: {
  db: PostgresDatabase;
  ownerUserId: string;
  rootProfileId: string;
}): Promise<boolean> {
  const result = await input.db.query<{ owner_user_id: string | null }>({
    text: `SELECT owner_user_id FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1 LIMIT 1`,
    values: [input.rootProfileId],
  });
  return result.rows[0]?.owner_user_id === input.ownerUserId;
}
/**
 * One urgent item per Session. A harness without Execution Contexts has no
 * Session id, so its questions coalesce per task instead.
 */
async function buildRuntimeCoordinatorSessionInboxSourceKey(input: {
  requestRoot: InteractionRequestRoot;
  runtimeCoordinatorExecutionId: string;
}): Promise<string> {
  const scope = input.requestRoot.contextId
    ? ["context", input.requestRoot.contextId]
    : ["execution", input.runtimeCoordinatorExecutionId];
  return `runtime_interaction_session_${await sha256Hex(JSON.stringify(scope))}`;
}
function resolveInteractionPresentation(input: {
  kind: AgentInteractionRequest["kind"];
  targetProfileName: string;
}): {
  preview: string;
  title: string;
} {
  switch (input.kind) {
    case "permission":
      return {
        preview: `${input.targetProfileName} needs your approval before it can continue.`,
        title: "Approval required",
      };
    case "question":
      return {
        preview: `${input.targetProfileName} needs your answer before it can continue.`,
        title: "Answer needed",
      };
    case "plan_review":
      return {
        preview: `${input.targetProfileName} needs you to review its plan before it can continue.`,
        title: "Plan ready for review",
      };
    default:
      return assertNeverInteractionKind(input.kind);
  }
}
async function buildRuntimeCoordinatorInteractionInboxSourceKey(
  input: Pick<
    RuntimeCoordinatorInteractionInboxSource,
    "interaction" | "runtimeCoordinatorExecutionId"
  >
): Promise<string> {
  const hex = await sha256Hex(
    JSON.stringify([
      input.runtimeCoordinatorExecutionId,
      input.interaction.interactionId,
    ])
  );
  return `runtime_interaction_${hex}`;
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
function assertNeverInteractionKind(value: never): never {
  throw new TypeError(`Unsupported Agent Interaction kind: ${String(value)}`);
}
