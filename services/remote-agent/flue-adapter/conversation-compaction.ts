import type { FlueObservation } from "@flue/runtime";
import {
  type RemoteAgentCallbackContext,
  type RemoteAgentStorage,
  recordRemoteAgentConversationCompaction,
} from "../agent-core/callback-context";

type FlueConversationCompactionStartObservation = Extract<
  FlueObservation,
  { type: "compaction_start" }
>;

type FlueConversationCompactionObservation = Extract<
  FlueObservation,
  { type: "compaction" }
>;

type ConversationCompactionStart = {
  estimatedTokens: number;
  eventIndex: number;
  observedAtMs: number;
  reason: FlueConversationCompactionStartObservation["reason"];
  submissionId: string;
  v: 1;
};

type ConversationCompactionObservation =
  | FlueConversationCompactionObservation
  | FlueConversationCompactionStartObservation;

type ConversationCompactionIssueCode =
  | "message_count_not_reduced"
  | "missing_start"
  | "repeated_in_submission";

export type RemoteAgentConversationCompactionObserver = {
  drain(submissionId: string): Promise<void>;
  enqueue(input: {
    event: ConversationCompactionObservation;
    storage: RemoteAgentStorage;
  }): void;
};

const ACTIVE_START_KEY = "remote_agent:conversation_compaction:active_start";

export function createRemoteAgentConversationCompactionObserver(): RemoteAgentConversationCompactionObserver {
  const pendingBySubmissionId = new Map<string, Promise<void>>();

  return {
    async drain(submissionId) {
      await pendingBySubmissionId.get(submissionId);
    },
    enqueue(input) {
      const submissionId = normalizeSubmissionId(input.event.submissionId);
      if (!submissionId) {
        console.warn(
          "[remote_agent.conversation_compaction.unattributed_event]",
          {
            eventIndex: input.event.eventIndex,
            eventType: input.event.type,
          }
        );
        return;
      }
      const previous =
        pendingBySubmissionId.get(submissionId) ?? Promise.resolve();
      const pending = previous
        .then(async () => {
          if (input.event.type === "compaction_start") {
            await recordConversationCompactionStart({
              event: input.event,
              storage: input.storage,
              submissionId,
            });
            return;
          }
          await recordConversationCompactionCompletion({
            event: input.event,
            storage: input.storage,
            submissionId,
          });
        })
        .catch((error: unknown) => {
          console.error(
            "[remote_agent.conversation_compaction.persistence_failed]",
            {
              error: toErrorMessage(error),
              eventIndex: input.event.eventIndex,
              eventType: input.event.type,
              submissionId,
            }
          );
        });
      pendingBySubmissionId.set(submissionId, pending);
      pending.finally(() => {
        if (pendingBySubmissionId.get(submissionId) === pending) {
          pendingBySubmissionId.delete(submissionId);
        }
      });
    },
  };
}

export function isConversationCompactionObservation(
  event: FlueObservation
): event is ConversationCompactionObservation {
  return event.type === "compaction_start" || event.type === "compaction";
}

async function recordConversationCompactionStart(input: {
  event: FlueConversationCompactionStartObservation;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  const observedAtMs = parseObservedAtMs(input.event.timestamp);
  const start: ConversationCompactionStart = {
    estimatedTokens: input.event.estimatedTokens,
    eventIndex: input.event.eventIndex,
    observedAtMs,
    reason: input.event.reason,
    submissionId: input.submissionId,
    v: 1,
  };
  await input.storage.put(ACTIVE_START_KEY, start);
  console.info("[remote_agent.conversation_compaction.started]", {
    estimatedTokens: start.estimatedTokens,
    eventIndex: start.eventIndex,
    observedAtMs,
    reason: start.reason,
    submissionId: input.submissionId,
  });
}

async function recordConversationCompactionCompletion(input: {
  event: FlueConversationCompactionObservation;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  const completedAtMs = parseObservedAtMs(input.event.timestamp);
  const storedStart =
    await input.storage.get<ConversationCompactionStart>(ACTIVE_START_KEY);
  const start =
    isConversationCompactionStart(storedStart) &&
    storedStart.submissionId === input.submissionId
      ? storedStart
      : null;
  if (input.event.isError) {
    await clearMatchingConversationCompactionStart({
      start,
      storage: input.storage,
      submissionId: input.submissionId,
    });
    console.warn("[remote_agent.conversation_compaction.failed]", {
      durationMs: input.event.durationMs,
      eventIndex: input.event.eventIndex,
      messagesAfter: input.event.messagesAfter,
      messagesBefore: input.event.messagesBefore,
      reason: start?.reason ?? null,
      submissionId: input.submissionId,
    });
    return;
  }

  const context = await recordRemoteAgentConversationCompaction({
    completedAtMs,
    storage: input.storage,
    submissionId: input.submissionId,
  });
  await clearMatchingConversationCompactionStart({
    start,
    storage: input.storage,
    submissionId: input.submissionId,
  });
  const issueCodes = resolveConversationCompactionIssueCodes({
    context,
    event: input.event,
    start,
  });
  const logContext = {
    completedAtMs,
    count: context.conversationCompaction?.count ?? 0,
    durationMs: input.event.durationMs,
    estimatedTokensBefore: start?.estimatedTokens ?? null,
    eventIndex: input.event.eventIndex,
    issueCodes,
    messagesAfter: input.event.messagesAfter,
    messagesBefore: input.event.messagesBefore,
    reason: start?.reason ?? null,
    submissionId: input.submissionId,
  };
  console.info("[remote_agent.conversation_compaction.completed]", logContext);
  if (issueCodes.length > 0) {
    console.warn(
      "[remote_agent.conversation_compaction.attention_required]",
      logContext
    );
  }
}

function resolveConversationCompactionIssueCodes(input: {
  context: RemoteAgentCallbackContext;
  event: FlueConversationCompactionObservation;
  start: ConversationCompactionStart | null;
}): ConversationCompactionIssueCode[] {
  const issueCodes: ConversationCompactionIssueCode[] = [];
  if (!input.start) {
    issueCodes.push("missing_start");
  }
  if (input.event.messagesAfter >= input.event.messagesBefore) {
    issueCodes.push("message_count_not_reduced");
  }
  if ((input.context.conversationCompaction?.count ?? 0) > 1) {
    issueCodes.push("repeated_in_submission");
  }
  return issueCodes;
}

async function clearMatchingConversationCompactionStart(input: {
  start: ConversationCompactionStart | null;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  if (input.start?.submissionId === input.submissionId) {
    await input.storage.delete(ACTIVE_START_KEY);
  }
}

function normalizeSubmissionId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseObservedAtMs(timestamp: string): number {
  const observedAtMs = Date.parse(timestamp);
  return Number.isFinite(observedAtMs) ? observedAtMs : Date.now();
}

function isConversationCompactionStart(
  value: unknown
): value is ConversationCompactionStart {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const candidate = value as Partial<ConversationCompactionStart>;
  return (
    candidate.v === 1 &&
    typeof candidate.submissionId === "string" &&
    (candidate.reason === "threshold" ||
      candidate.reason === "overflow" ||
      candidate.reason === "manual") &&
    typeof candidate.estimatedTokens === "number" &&
    typeof candidate.observedAtMs === "number" &&
    typeof candidate.eventIndex === "number"
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const remoteAgentConversationCompactionObserver =
  createRemoteAgentConversationCompactionObserver();
