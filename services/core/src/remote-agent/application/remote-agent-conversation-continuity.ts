import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import {
  buildRemoteAgentRuntimeConversationId,
  REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS,
  REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES,
  REMOTE_AGENT_CONVERSATION_CONTINUITY_TOTAL_TEXT_MAX_CHARS,
  remoteAgentWorkerSubmitTurnRequestV4Schema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RemoteAgentConversationContinuityContext,
  RemoteAgentConversationContinuityEntry,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkerSubmitTurnRequestV4,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { buildCenterAgentContextMessageProjection } from "../../center-agent/application/center-agent-context-manifest-service";
import { readCenterAgentTaskConversationContinuity } from "../../center-agent-tasks/application/center-agent-task-conversation-continuity";
import type { CoreBindings } from "../../lib/bindings";
import type { ListSignalsInput, ListSignalsResult } from "../../rpc/methods";
import { resolveSpaceStub } from "../../rpc/space-ref";

const CONTINUITY_CONTEXT_TOKEN_BUDGET = 8000;
const TEXT_ENCODER = new TextEncoder();

type ContinuityEntryDraft = Omit<
  RemoteAgentConversationContinuityEntry,
  "content"
> & {
  content: {
    originalCharacterCount: number;
    text: string;
    truncated: boolean;
  };
};

class RemoteAgentConversationContinuitySourceError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string }) {
    super(`${input.code}: ${input.message}`);
    this.code = input.code;
    this.name = "RemoteAgentConversationContinuitySourceError";
  }
}

export function resolveRemoteAgentLogicalConversationId(
  request: RemoteAgentWorkerSubmitTurnRequest
): string {
  return request.conversationId ?? request.spaceId;
}

export function resolveRemoteAgentRuntimeConversationId(
  request: RemoteAgentWorkerSubmitTurnRequest
): string | undefined {
  return request.v === 4
    ? request.runtimeConversation.id
    : request.conversationId;
}

function resolvePersistedRemoteAgentRuntimeConversationId(
  request: RemoteAgentWorkerSubmitTurnRequest | null
): string | undefined {
  if (!request) {
    return undefined;
  }
  return resolveRemoteAgentRuntimeConversationId(request) ?? request.spaceId;
}

export function resolveRemoteAgentNativeDeliveryRuntimeConversationId(input: {
  executionRecoverySubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
}): string | undefined {
  const workerRuntimeConversationId =
    resolvePersistedRemoteAgentRuntimeConversationId(input.workerSubmitRequest);
  const recoveryRuntimeConversationId =
    resolvePersistedRemoteAgentRuntimeConversationId(
      input.executionRecoverySubmitRequest
    );
  if (
    workerRuntimeConversationId &&
    recoveryRuntimeConversationId &&
    workerRuntimeConversationId !== recoveryRuntimeConversationId
  ) {
    throw new Error("remote_agent.runtime_conversation_identity_mismatch");
  }
  return workerRuntimeConversationId ?? recoveryRuntimeConversationId;
}

export function buildRemoteAgentWorkerSubmitTurnRequestV4(input: {
  continuityContext?: RemoteAgentConversationContinuityContext;
  generation: number;
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>;
}): RemoteAgentWorkerSubmitTurnRequestV4 {
  const {
    continuityContext: _previousContinuityContext,
    runtimeConversation: _previousRuntimeConversation,
    v: _previousVersion,
    ...request
  } = input.request.v === 4
    ? input.request
    : {
        ...input.request,
        continuityContext: undefined,
        runtimeConversation: undefined,
      };
  const logicalConversationId = resolveRemoteAgentLogicalConversationId(
    input.request
  );
  return remoteAgentWorkerSubmitTurnRequestV4Schema.parse({
    ...request,
    conversationId: logicalConversationId,
    ...(input.continuityContext
      ? { continuityContext: input.continuityContext }
      : {}),
    runtimeConversation: {
      generation: input.generation,
      id: buildRemoteAgentRuntimeConversationId({
        generation: input.generation,
        logicalConversationId,
        organizationId: input.request.organizationId,
      }),
    },
    v: 4,
  });
}

export async function buildRemoteAgentConversationContinuityContext(input: {
  db: D1Database;
  env: CoreBindings;
  generation: number;
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>;
}): Promise<RemoteAgentConversationContinuityContext> {
  if (input.generation < 1) {
    throw new Error(
      "Remote Agent rollover continuity requires a positive generation."
    );
  }
  const logicalConversationId = resolveRemoteAgentLogicalConversationId(
    input.request
  );
  const source = await readContinuityEntryDrafts(input);
  const materialized = await boundContinuityEntries(source.entries);
  if (materialized.entries.length === 0) {
    throw new Error(
      "Remote Agent could not materialize authorized continuity for the next runtime generation."
    );
  }
  return {
    entries: materialized.entries,
    fromGeneration: input.generation - 1,
    logicalConversationId,
    toGeneration: input.generation,
    truncated: source.truncated || materialized.truncated,
    v: 1,
  };
}

async function readContinuityEntryDrafts(input: {
  db: D1Database;
  env: CoreBindings;
  generation: number;
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>;
}): Promise<{ entries: ContinuityEntryDraft[]; truncated: boolean }> {
  if (
    (input.request.v === 3 || input.request.v === 4) &&
    input.request.conversationIdentity?.kind === "center_agent_task"
  ) {
    return await readTaskContinuityEntryDrafts({
      db: input.db,
      request: input.request,
      taskId: input.request.conversationIdentity.taskId,
    });
  }
  if (
    input.request.turnEnvelope.trigger.source === "slack" ||
    input.request.turnEnvelope.trigger.source === "message_channel" ||
    (input.request.turnEnvelope.trigger.source === "routine" &&
      input.request.turnEnvelope.trigger.destination?.kind === "slack_thread")
  ) {
    return readMessageChannelContinuityEntryDrafts(input.request);
  }
  return await readSpaceContinuityEntryDrafts({
    env: input.env,
    request: input.request,
  });
}

function readMessageChannelContinuityEntryDrafts(
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>
): { entries: ContinuityEntryDraft[]; truncated: boolean } {
  const channelContext = request.turnEnvelope.channelContext;
  if (
    !channelContext ||
    (channelContext.sync.status !== "complete" &&
      channelContext.sync.status !== "truncated")
  ) {
    return { entries: [], truncated: true };
  }
  return {
    entries: channelContext.messages.map((message) => ({
      author: message.author,
      content: {
        originalCharacterCount: Array.from(message.text).length,
        text: message.text,
        truncated: false,
      },
      occurredAt: new Date(message.sentAtMs).toISOString(),
      source: {
        conversationId: channelContext.conversationId,
        kind: "message_channel_message",
        messageId: message.id,
        provider: channelContext.provider,
      },
    })),
    truncated: channelContext.sync.status === "truncated",
  };
}

async function readTaskContinuityEntryDrafts(input: {
  db: D1Database;
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>;
  taskId: string;
}): Promise<{ entries: ContinuityEntryDraft[]; truncated: boolean }> {
  const projection = await readCenterAgentTaskConversationContinuity({
    db: input.db,
    limit: REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES,
    organizationId: input.request.organizationId,
    taskId: input.taskId,
    triggerEventId: input.request.triggerMessageId,
  });
  return {
    entries: projection.entries.map((entry) => ({
      author: {
        kind: entry.authorKind,
      },
      content: {
        originalCharacterCount: Array.from(entry.text).length,
        text: entry.text,
        truncated: false,
      },
      occurredAt: entry.occurredAt,
      source: {
        eventId: entry.eventId,
        kind: "center_agent_task_event" as const,
        taskId: entry.taskId,
      },
    })),
    truncated: projection.truncated,
  };
}

async function readSpaceContinuityEntryDrafts(input: {
  env: CoreBindings;
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>;
}): Promise<{ entries: ContinuityEntryDraft[]; truncated: boolean }> {
  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.request.spaceId
  ) as {
    rpcListDispatchConversationContinuitySignalsResult(
      request: ListSignalsInput
    ): Promise<
      | { ok: true; value: ListSignalsResult }
      | { code?: string; message: string; ok: false; status: number }
    >;
  } | null;
  if (!stub) {
    throw new RemoteAgentConversationContinuitySourceError({
      code: "space.continuity.owner_unavailable",
      message: "The Space owner is unavailable for rollover continuity.",
    });
  }
  const requestContext = buildContinuityRequestContext(input.request);
  const result = await stub.rpcListDispatchConversationContinuitySignalsResult({
    aroundSignalId: input.request.triggerMessageId,
    beforeCount: REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES + 1,
    signalTypes: ["signal.text"],
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      dispatchId: input.request.dispatchId,
      requestContext,
      sourceSignalId: input.request.triggerMessageId,
      spaceId: input.request.spaceId,
      targetProfileId: input.request.agentProfileId,
    }),
    spaceId: input.request.spaceId,
  });
  if (!result.ok) {
    throw new RemoteAgentConversationContinuitySourceError({
      code: result.code ?? "space.continuity.read_failed",
      message: result.message,
    });
  }
  const candidateSignals = result.value.signals.filter(
    (signal) => signal.id !== input.request.triggerMessageId
  );
  const projection = await buildCenterAgentContextMessageProjection({
    hasOlderMessages:
      candidateSignals.length >
      REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES,
    limit: REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES,
    maxContextTokens: CONTINUITY_CONTEXT_TOKEN_BUDGET,
    signals: candidateSignals,
    spaceId: input.request.spaceId,
  });
  return {
    entries: projection.entries.map((entry) => ({
      author: {
        displayName: entry.author.profileName,
        id: entry.author.profileId,
        kind: entry.author.profileKind,
      },
      content: {
        originalCharacterCount: entry.content.originalCharacterCount,
        text: entry.content.text,
        truncated: entry.content.truncated,
      },
      occurredAt: entry.occurredAt,
      source: {
        kind: "space_signal" as const,
        signalId: entry.sourceRef.id,
        spaceId: input.request.spaceId,
        version: entry.sourceRef.version,
      },
    })),
    truncated: projection.budget.truncated,
  };
}

function buildContinuityRequestContext(
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>
): OpenMeldRequestContext {
  return {
    activeOrganizationId: request.organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      ownerUserId: request.agentProfileOwnerUserId,
      profileKind: "agent",
      profileName: request.turnEnvelope.centerAgent.profileName,
      requestId: `remote-agent-continuity-${request.dispatchId}`,
      openMeldProfileId: request.agentProfileId,
    },
  };
}

async function boundContinuityEntries(
  drafts: readonly ContinuityEntryDraft[]
): Promise<{
  entries: RemoteAgentConversationContinuityEntry[];
  truncated: boolean;
}> {
  const perEntryBounded = drafts.map((draft) => {
    const characters = Array.from(draft.content.text);
    if (
      characters.length <=
      REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS
    ) {
      return draft;
    }
    return {
      ...draft,
      content: {
        ...draft.content,
        text: characters
          .slice(0, REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS)
          .join(""),
        truncated: true,
      },
    };
  });
  const limited = perEntryBounded.slice(
    -REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES
  );
  const selectedNewestFirst: ContinuityEntryDraft[] = [];
  let remainingCharacters =
    REMOTE_AGENT_CONVERSATION_CONTINUITY_TOTAL_TEXT_MAX_CHARS;
  let truncated =
    drafts.length > limited.length ||
    perEntryBounded.some((draft) => draft.content.truncated);
  for (const draft of limited.toReversed()) {
    const characters = Array.from(draft.content.text);
    if (characters.length <= remainingCharacters) {
      selectedNewestFirst.push(draft);
      remainingCharacters -= characters.length;
      truncated ||= draft.content.truncated;
      continue;
    }
    if (remainingCharacters > 0) {
      selectedNewestFirst.push({
        ...draft,
        content: {
          ...draft.content,
          text: characters.slice(0, remainingCharacters).join(""),
          truncated: true,
        },
      });
    }
    truncated = true;
    break;
  }
  const entries = await Promise.all(
    selectedNewestFirst.toReversed().map(async (draft) => ({
      ...draft,
      content: {
        ...draft.content,
        materializedContentHash: await sha256(draft.content.text),
      },
    }))
  );
  return { entries, truncated };
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    TEXT_ENCODER.encode(value)
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
