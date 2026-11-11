import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { buildCenterAgentContextMessageProjection } from "@openmeld/protocol";
import {
  buildRemoteAgentRoutineRunConversationId,
  buildRemoteAgentRuntimeConversationId,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
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
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../../lib/bindings";
import type { ListSignalsInput, ListSignalsResult } from "../../rpc/methods";
import { resolveSpaceStub } from "../../rpc/space-ref";
import type { SpaceRpcJsonResult } from "../../space/transport/rpc/space-rpc-adapter";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/postgresql/native-delivery-ledger-repo";

const CONTINUITY_CONTEXT_TOKEN_BUDGET = 8000;
const TEXT_ENCODER = new TextEncoder();

/** Publication stays in the Space. Independent requests must never share the
 * same model history merely because their participants share a room. */
export function resolveCenterAgentSpaceConversationId(input: {
  spaceId: string;
  sourceSignalId: string;
  threadContext?: SpaceThreadContext | null;
  isCenterAgentDm: boolean;
}): string {
  return input.isCenterAgentDm
    ? input.spaceId
    : `center-space:${input.spaceId}:root:${input.threadContext?.rootSignalId ?? input.sourceSignalId}`;
}
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
  constructor(input: {
    code: string;
    message: string;
  }) {
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
export function isRemoteAgentRoutineRunConversation(
  request: RemoteAgentWorkerSubmitTurnRequest
): boolean {
  const trigger = request.turnEnvelope.trigger;
  return (
    trigger.source === "routine" &&
    request.conversationId ===
      buildRemoteAgentRoutineRunConversationId({
        agentProfileId: request.agentProfileId,
        organizationId: request.organizationId,
        runId: trigger.runId,
      })
  );
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
export function resolveRemoteAgentNativeDeliveryRuntimeConversationId(
  input: Pick<
    RemoteAgentNativeDeliveryRecord,
    | "organizationId"
    | "profileId"
    | "spaceId"
    | "dispatchId"
    | "idempotencyKey"
    | "executionRecoverySubmitRequest"
    | "workerSubmitRequest"
  >
): string | undefined {
  for (const request of [
    input.workerSubmitRequest,
    input.executionRecoverySubmitRequest,
  ]) {
    if (
      request &&
      (request.organizationId !== input.organizationId ||
        request.agentProfileId !== input.profileId ||
        request.spaceId !== input.spaceId ||
        request.dispatchId !== input.dispatchId ||
        request.idempotencyKey !== input.idempotencyKey)
    ) {
      throw new Error("remote_agent.native_delivery_identity_mismatch");
    }
  }
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
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >;
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
  db: PostgresDatabase;
  env: CoreBindings;
  generation: number;
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >;
  sourceDispatchId?: string;
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
  db: PostgresDatabase;
  env: CoreBindings;
  generation: number;
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >;
  sourceDispatchId?: string;
}): Promise<{
  entries: ContinuityEntryDraft[];
  truncated: boolean;
}> {
  if (isRemoteAgentRoutineRunConversation(input.request)) {
    throw new RemoteAgentConversationContinuitySourceError({
      code: "remote_agent.routine_run_continuity_unavailable",
      message:
        "A Routine Run cannot use its publication destination as execution continuity.",
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
    sourceDispatchId: input.sourceDispatchId,
  });
}
function readMessageChannelContinuityEntryDrafts(
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >
): {
  entries: ContinuityEntryDraft[];
  truncated: boolean;
} {
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
async function readSpaceContinuityEntryDrafts(input: {
  env: CoreBindings;
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >;
  sourceDispatchId?: string;
}): Promise<{
  entries: ContinuityEntryDraft[];
  truncated: boolean;
}> {
  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.request.spaceId
  ) as {
    rpcListRequestRootContinuitySignalsResult(
      request: ListSignalsInput
    ): Promise<SpaceRpcJsonResult<ListSignalsResult>>;
    rpcListDispatchConversationContinuitySignalsResult(
      request: ListSignalsInput
    ): Promise<SpaceRpcJsonResult<ListSignalsResult>>;
  } | null;
  if (!stub) {
    throw new RemoteAgentConversationContinuitySourceError({
      code: "space.continuity.owner_unavailable",
      message: "The Space owner is unavailable for rollover continuity.",
    });
  }
  const requestContext = buildContinuityRequestContext(input.request);
  const requestRoot =
    !input.request.turnEnvelope.space.isCenterAgentDm &&
    input.request.conversationId ===
      resolveCenterAgentSpaceConversationId({
        spaceId: input.request.spaceId,
        sourceSignalId: input.request.triggerMessageId,
        isCenterAgentDm: false,
      });
  const query: ListSignalsInput = {
    aroundSignalId: input.request.triggerMessageId,
    beforeCount: REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES + 1,
    signalTypes: ["signal.text"],
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      dispatchId: input.sourceDispatchId ?? input.request.dispatchId,
      requestContext,
      sourceSignalId: input.request.triggerMessageId,
      spaceId: input.request.spaceId,
      targetProfileId: input.request.agentProfileId,
    }),
    spaceId: input.request.spaceId,
  };
  const result = requestRoot
    ? await stub.rpcListRequestRootContinuitySignalsResult(query)
    : await stub.rpcListDispatchConversationContinuitySignalsResult(query);
  if (!result.ok) {
    throw new RemoteAgentConversationContinuitySourceError({
      code: result.code ?? "space.continuity.read_failed",
      message: result.message,
    });
  }
  const candidateSignals = requestRoot
    ? result.value.signals
    : result.value.signals.filter(
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
      ...(entry.reactions ? { reactions: entry.reactions } : {}),
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
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >
): OpenMeldRequestContext {
  return {
    activeOrganizationId: request.organizationId,
    actorContext: {
      agentControllerRef:
        request.v === 4 &&
        request.conversationIdentity?.kind === "personal_agent"
          ? HOSTED_REMOTE_AGENT_CONTROLLER_REF
          : HOSTED_CENTER_AGENT_CONTROLLER_REF,
      ...(request.agentProfileOwnerUserId
        ? { ownerUserId: request.agentProfileOwnerUserId }
        : {}),
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
        materializedContentHash: await sha256(
          draft.reactions
            ? JSON.stringify({
                text: draft.content.text,
                reactions: draft.reactions,
              })
            : draft.content.text
        ),
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
