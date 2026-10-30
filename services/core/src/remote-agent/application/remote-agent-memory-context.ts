import {
  canRecallCenterAgentMemberMemory,
  canRecallCenterAgentOrganizationMemory,
  resolveCenterAgentContextScopePlan,
} from "@openmeld/agent-runtime";
import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";
import { CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS } from "../../center-agent-memory/contract";
import { createCoreCenterAgentMemoryService } from "../../center-agent-memory/core-memory-service";
import type { CenterAgentMemoryService } from "../../center-agent-memory/memory-service";
import type { CoreBindings } from "../../lib/bindings";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";

const MEMORY_RECALL_CONTEXT_MESSAGE_LIMIT = 8;
const MEMORY_RECALL_CONTEXT_MESSAGE_MAX_CHARS = 1200;

export async function attachCenterAgentMemoryToTurnEnvelope(input: {
  env: CoreBindings;
  memoryService?: CenterAgentMemoryService | null;
  organizationId: string;
  query: string;
  turnEnvelope: RemoteAgentTurnEnvelope;
}): Promise<RemoteAgentTurnEnvelope> {
  const turnEnvelope = { ...input.turnEnvelope };
  turnEnvelope.memory = undefined;
  const memoryService =
    input.memoryService === undefined
      ? createCoreCenterAgentMemoryService(input.env)
      : input.memoryService;
  const contextScopePlan = resolveCenterAgentContextScopePlan(turnEnvelope);
  if (
    !(
      canRecallCenterAgentMemberMemory(contextScopePlan) ||
      canRecallCenterAgentOrganizationMemory(contextScopePlan)
    )
  ) {
    return turnEnvelope;
  }
  const unavailableMemory = {
    items: [],
    truncated: false,
    status: "unavailable" as const,
  };
  if (!memoryService) {
    return { ...turnEnvelope, memory: unavailableMemory };
  }

  try {
    const query = buildCenterAgentMemoryRecallQuery({
      currentQuery: input.query,
      turnEnvelope,
    });
    const speakerMember = resolveEnvelopeMemorySpeaker(turnEnvelope);
    const memory =
      speakerMember && canRecallCenterAgentMemberMemory(contextScopePlan)
        ? await memoryService.recallForTurn({
            organizationId: input.organizationId,
            query,
            speakerMember,
            ...(contextScopePlan.interactionEnvironment ===
              "organization_shared" &&
            turnEnvelope.space.kind === "space" &&
            turnEnvelope.trigger.source !== "slack" &&
            turnEnvelope.trigger.source !== "message_channel"
              ? { spaceId: turnEnvelope.space.id }
              : {}),
          })
        : await memoryService.recallForOrganization({
            organizationId: input.organizationId,
            query,
          });
    return memory.items.length > 0 || memory.status || memory.truncated
      ? { ...turnEnvelope, memory }
      : turnEnvelope;
  } catch (error) {
    console.warn("[core.center_agent_memory.recall_unavailable]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      error: toErrorMessage(error),
      organizationId: input.organizationId,
      spaceId: turnEnvelope.space.id,
    });
    return { ...turnEnvelope, memory: unavailableMemory };
  }
}

function buildCenterAgentMemoryRecallQuery(input: {
  currentQuery: string;
  turnEnvelope: RemoteAgentTurnEnvelope;
}): string {
  const currentQuery = truncateText(
    input.currentQuery,
    CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS
  );
  const channelMessages = input.turnEnvelope.channelContext?.messages ?? [];
  if (channelMessages.length === 0) {
    return currentQuery;
  }
  const contextLines = channelMessages
    .slice(-MEMORY_RECALL_CONTEXT_MESSAGE_LIMIT)
    .map((message) => {
      const messageText = normalizeOptionalText(message.text);
      if (!messageText) {
        return null;
      }
      const author = formatChannelContextAuthor(message.author);
      const text = truncateText(
        messageText,
        MEMORY_RECALL_CONTEXT_MESSAGE_MAX_CHARS
      );
      return `- ${author}: ${text}`;
    })
    .filter((line): line is string => line !== null);
  if (contextLines.length === 0) {
    return currentQuery;
  }
  const queryPrefix = [
    "Current request:",
    currentQuery,
    "",
    "Recent conversation context:",
  ].join("\n");
  const contextBudget =
    CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS - queryPrefix.length - 1;
  if (contextBudget <= 0) {
    return currentQuery;
  }

  const selectedContextLines: string[] = [];
  let remainingCharacters = contextBudget;
  for (const contextLine of contextLines.toReversed()) {
    const separatorCharacters = selectedContextLines.length > 0 ? 1 : 0;
    const availableCharacters = remainingCharacters - separatorCharacters;
    if (availableCharacters <= 0) {
      break;
    }
    if (contextLine.length <= availableCharacters) {
      selectedContextLines.unshift(contextLine);
      remainingCharacters -= contextLine.length + separatorCharacters;
      continue;
    }
    if (selectedContextLines.length === 0) {
      selectedContextLines.unshift(
        truncateText(contextLine, availableCharacters)
      );
    }
    break;
  }

  return selectedContextLines.length > 0
    ? `${queryPrefix}\n${selectedContextLines.join("\n")}`
    : currentQuery;
}

function formatChannelContextAuthor(
  author: NonNullable<
    RemoteAgentTurnEnvelope["channelContext"]
  >["messages"][number]["author"]
): string {
  if (author.displayName) {
    return author.displayName;
  }
  if ("id" in author && author.id) {
    return author.id;
  }
  return author.kind;
}

function resolveEnvelopeMemorySpeaker(
  envelope: RemoteAgentTurnEnvelope
): { memberId: string; userId: string } | null {
  if (
    envelope.sender.kind !== "member" ||
    !envelope.sender.verified ||
    !envelope.sender.ownerUserId
  ) {
    return null;
  }
  return {
    memberId: envelope.sender.id,
    userId: envelope.sender.ownerUserId,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }
  if (maxCharacters <= 3) {
    return value.slice(0, maxCharacters);
  }
  return `${value.slice(0, maxCharacters - 3)}...`;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
