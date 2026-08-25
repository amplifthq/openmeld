import {
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_PREVIEW_MAX_CHARS,
} from "@openmeld/schemas";
import type { AgentInteractionRequest } from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import {
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
};

export async function projectRuntimeCoordinatorInteractionInboxItem(
  input: RuntimeCoordinatorInteractionInboxSource & {
    inboxDb: D1Database;
    nowMs: number;
    spaceIndexDb: D1Database;
  }
): Promise<void> {
  const target = await readSpaceIndexOrganizationJoinTarget({
    db: input.spaceIndexDb,
    spaceId: input.spaceId,
  });
  if (!target) {
    throw new Error("runtime_coordinator.interaction_inbox.space_unavailable");
  }
  const recipientAccess = await readHumanSpaceMembershipAccessForOwner({
    db: input.spaceIndexDb,
    organizationId: target.organizationId,
    ownerUserId: input.ownerUserId,
    spaceId: input.spaceId,
  });
  if (recipientAccess === "removed") {
    return;
  }
  if (recipientAccess === "missing") {
    throw new Error(
      "runtime_coordinator.interaction_inbox.membership_projection_unavailable"
    );
  }
  const presentation = resolveInteractionPresentation({
    kind: input.interaction.kind,
    targetProfileName: input.targetProfileName,
  });
  await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: truncateInboxText(
        input.targetProfileName,
        INBOX_CONTEXT_LABEL_MAX_CHARS
      ),
      importance: "urgent",
      kind: "agent_interaction",
      occurredAtMs: input.interaction.requestedAtMs,
      organizationId: target.organizationId,
      preview: truncateInboxText(presentation.preview, INBOX_PREVIEW_MAX_CHARS),
      recipientUserId: input.ownerUserId,
      sourceKey: await buildRuntimeCoordinatorInteractionInboxSourceKey(input),
      sourceKind: RUNTIME_COORDINATOR_INTERACTION_SOURCE_KIND,
      sourceTarget: {
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
    },
    db: input.inboxDb,
    nowMs: input.nowMs,
  });
}

export async function resolveRuntimeCoordinatorInteractionInboxItem(
  input: Pick<
    RuntimeCoordinatorInteractionInboxSource,
    "interaction" | "runtimeCoordinatorExecutionId" | "spaceId"
  > & {
    inboxDb: D1Database;
    resolvedAtMs: number;
    spaceIndexDb: D1Database;
  }
): Promise<void> {
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
}

function resolveInteractionPresentation(input: {
  kind: AgentInteractionRequest["kind"];
  targetProfileName: string;
}): { preview: string; title: string } {
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
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      input.runtimeCoordinatorExecutionId,
      input.interaction.interactionId,
    ])
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `runtime_interaction_${hex}`;
}

function assertNeverInteractionKind(value: never): never {
  throw new TypeError(`Unsupported Agent Interaction kind: ${String(value)}`);
}
