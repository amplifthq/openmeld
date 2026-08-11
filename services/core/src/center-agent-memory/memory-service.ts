import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  CENTER_AGENT_MEMORY_MAX_ENVELOPE_TEXT_CHARS,
  CENTER_AGENT_MEMORY_MAX_ITEM_TEXT_CHARS,
  CENTER_AGENT_MEMORY_MAX_ITEMS,
  CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS,
  CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS,
  CENTER_AGENT_MEMORY_WRITE_TIMEOUT_MS,
  type CenterAgentMemoryAdapter,
  type CenterAgentMemoryEpisodeOrigin,
  type CenterAgentMemoryLogger,
  type CenterAgentMemoryNativeDeliveryLedger,
  type CenterAgentMemoryPolicy,
  type CenterAgentMemoryRepository,
  type CenterAgentMemorySearchResult,
  type RecallCenterAgentMemoryForTurnInput,
  type RecallCenterAgentMemoryForTurnResult,
  type RecallCenterAgentOrganizationMemoryInput,
  type RememberCenterAgentTurnInput,
} from "./contract";

export type CenterAgentMemoryService = {
  deleteMemberMemory(input: {
    organizationId: string;
    userId: string;
  }): Promise<"deleted" | "not_found">;
  deleteOrganizationMemory(input: {
    organizationId: string;
  }): Promise<"deleted" | "not_found">;
  recallForTurn(
    input: RecallCenterAgentMemoryForTurnInput
  ): Promise<RecallCenterAgentMemoryForTurnResult>;
  recallForOrganization(
    input: RecallCenterAgentOrganizationMemoryInput
  ): Promise<RecallCenterAgentMemoryForTurnResult>;
  readOrganizationMemoryPolicy(
    organizationId: string
  ): Promise<CenterAgentMemoryPolicy>;
  rememberFactForOrganization(input: {
    fact: string;
    organizationId: string;
    origin: CenterAgentMemoryEpisodeOrigin;
    speakerMember: RememberCenterAgentTurnInput["speakerMember"];
  }): Promise<void>;
  rememberTurn(input: RememberCenterAgentTurnInput): Promise<void>;
  setOrganizationMemoryPolicy(input: {
    organizationId: string;
    organizationMemoryOptIn: boolean;
    updatedByUserId: string;
  }): Promise<CenterAgentMemoryPolicy>;
};

export function createCenterAgentMemoryService(input: {
  adapter: CenterAgentMemoryAdapter;
  logger?: CenterAgentMemoryLogger;
  nativeDeliveryLedger?: CenterAgentMemoryNativeDeliveryLedger;
  nowMs?: () => number;
  repository: CenterAgentMemoryRepository;
  recallTimeoutMs?: number;
  writeTimeoutMs?: number;
}): CenterAgentMemoryService {
  const nowMs = input.nowMs ?? Date.now;
  const logger = input.logger ?? console;
  const recallTimeoutMs =
    input.recallTimeoutMs ?? CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS;
  const writeTimeoutMs =
    input.writeTimeoutMs ?? CENTER_AGENT_MEMORY_WRITE_TIMEOUT_MS;

  return {
    async deleteMemberMemory(deleteInput) {
      const ref = buildCenterAgentMemberMemoryRef({
        memberId: "deleted_member",
        organizationId: deleteInput.organizationId,
        userId: deleteInput.userId,
      });
      await input.nativeDeliveryLedger?.clearTriggerTextForMember({
        organizationId: deleteInput.organizationId,
        userId: deleteInput.userId,
      });
      try {
        const deleteStatus = await withTimeout(
          input.adapter.deleteMemberUser(ref),
          writeTimeoutMs,
          "center_agent_memory.member_delete_timeout"
        );
        const rowExisted = await input.repository.markMemberDeleted({
          deletedAtMs: nowMs(),
          organizationId: deleteInput.organizationId,
          userId: deleteInput.userId,
        });
        return deleteStatus === "deleted" || rowExisted
          ? "deleted"
          : "not_found";
      } catch (error) {
        await input.repository.markMemberDeleteFailed({
          error: toErrorMessage(error),
          nowMs: nowMs(),
          organizationId: deleteInput.organizationId,
          userId: deleteInput.userId,
        });
        throw error;
      }
    },

    async deleteOrganizationMemory(deleteInput) {
      const ref = buildCenterAgentOrganizationMemoryRef({
        organizationId: deleteInput.organizationId,
      });
      await input.nativeDeliveryLedger?.clearTriggerTextForOrganization({
        organizationId: deleteInput.organizationId,
      });
      try {
        const deleteStatus = await withTimeout(
          input.adapter.deleteOrganizationGraph(ref),
          writeTimeoutMs,
          "center_agent_memory.organization_delete_timeout"
        );
        const rowExisted = await input.repository.markOrganizationDeleted({
          deletedAtMs: nowMs(),
          organizationId: deleteInput.organizationId,
        });
        return deleteStatus === "deleted" || rowExisted
          ? "deleted"
          : "not_found";
      } catch (error) {
        await input.repository.markOrganizationDeleteFailed({
          error: toErrorMessage(error),
          nowMs: nowMs(),
          organizationId: deleteInput.organizationId,
        });
        throw error;
      }
    },

    async recallForTurn(recallInput) {
      const policy = await input.repository.readPolicy(
        recallInput.organizationId
      );
      const memberRef = await input.repository.upsertMemberSubject({
        memberId: recallInput.speakerMember.memberId,
        nowMs: nowMs(),
        organizationId: recallInput.organizationId,
        userId: recallInput.speakerMember.userId,
      });

      const recallTasks = [
        recallMemory({
          adapter: input.adapter,
          limit: CENTER_AGENT_MEMORY_MAX_ITEMS,
          logger,
          query: recallInput.query,
          ref: memberRef,
          timeoutMs: recallTimeoutMs,
        }),
      ];

      if (policy.organizationMemoryOptIn) {
        const organizationRef =
          await input.repository.upsertOrganizationSubject({
            nowMs: nowMs(),
            organizationId: recallInput.organizationId,
          });
        recallTasks.push(
          recallMemory({
            adapter: input.adapter,
            limit: CENTER_AGENT_MEMORY_MAX_ITEMS,
            logger,
            query: recallInput.query,
            ref: organizationRef,
            timeoutMs: recallTimeoutMs,
          })
        );
      }

      const results = (await Promise.all(recallTasks)).flat();
      return projectMemoryEnvelope(results);
    },

    async recallForOrganization(recallInput) {
      const policy = await input.repository.readPolicy(
        recallInput.organizationId
      );
      if (!policy.organizationMemoryOptIn) {
        return projectMemoryEnvelope([]);
      }
      const organizationRef = await input.repository.upsertOrganizationSubject({
        nowMs: nowMs(),
        organizationId: recallInput.organizationId,
      });
      const results = await recallMemory({
        adapter: input.adapter,
        limit: CENTER_AGENT_MEMORY_MAX_ITEMS,
        logger,
        query: recallInput.query,
        ref: organizationRef,
        timeoutMs: recallTimeoutMs,
      });
      return projectMemoryEnvelope(results);
    },

    async readOrganizationMemoryPolicy(organizationId) {
      return await input.repository.readPolicy(organizationId);
    },

    async rememberFactForOrganization(factInput) {
      const policy = await input.repository.readPolicy(
        factInput.organizationId
      );
      if (!policy.organizationMemoryOptIn) {
        throw new Error(
          "center_agent_memory.organization_memory_opt_in_required"
        );
      }
      const episode = {
        assistantMessage: `Saved to organization memory: ${factInput.fact}`,
        captureMethod: "explicit_save" as const,
        ...factInput.origin,
        userMessage: factInput.fact,
      };
      const organizationRef = await input.repository.upsertOrganizationSubject({
        nowMs: nowMs(),
        organizationId: factInput.organizationId,
      });
      await withTimeout(
        input.adapter.ensureOrganizationGraph(organizationRef),
        writeTimeoutMs,
        "center_agent_memory.organization_ensure_timeout"
      );
      await withTimeout(
        input.adapter.addEpisode({ episode, ref: organizationRef }),
        writeTimeoutMs,
        "center_agent_memory.organization_write_timeout"
      );
    },

    async rememberTurn(rememberInput) {
      const episode = {
        assistantMessage: rememberInput.assistantMessage,
        captureMethod: "automatic_turn" as const,
        ...(rememberInput.messageChannelProvider
          ? { messageChannelProvider: rememberInput.messageChannelProvider }
          : {}),
        occurredAtMs: rememberInput.occurredAtMs,
        source: rememberInput.source,
        sourceConversationId: rememberInput.sourceConversationId,
        sourceMessageId: rememberInput.sourceMessageId,
        userMessage: rememberInput.userMessage,
      };

      if (rememberInput.source === "ca_dm") {
        const memberRef = await input.repository.upsertMemberSubject({
          memberId: rememberInput.speakerMember.memberId,
          nowMs: nowMs(),
          organizationId: rememberInput.organizationId,
          userId: rememberInput.speakerMember.userId,
        });
        await withTimeout(
          input.adapter.ensureMemberUser(memberRef),
          writeTimeoutMs,
          "center_agent_memory.member_ensure_timeout"
        );
        await withTimeout(
          input.adapter.addEpisode({ episode, ref: memberRef }),
          writeTimeoutMs,
          "center_agent_memory.member_write_timeout"
        );
        return;
      }

      const policy = await input.repository.readPolicy(
        rememberInput.organizationId
      );
      if (!policy.organizationMemoryOptIn) {
        return;
      }

      const organizationRef = await input.repository.upsertOrganizationSubject({
        nowMs: nowMs(),
        organizationId: rememberInput.organizationId,
      });
      await withTimeout(
        input.adapter.ensureOrganizationGraph(organizationRef),
        writeTimeoutMs,
        "center_agent_memory.organization_ensure_timeout"
      );
      await withTimeout(
        input.adapter.addEpisode({ episode, ref: organizationRef }),
        writeTimeoutMs,
        "center_agent_memory.organization_write_timeout"
      );
    },

    async setOrganizationMemoryPolicy(policyInput) {
      return await input.repository.upsertPolicy({
        nowMs: nowMs(),
        organizationId: policyInput.organizationId,
        organizationMemoryOptIn: policyInput.organizationMemoryOptIn,
        updatedByUserId: policyInput.updatedByUserId,
      });
    },
  };
}

async function recallMemory(input: {
  adapter: CenterAgentMemoryAdapter;
  limit: number;
  logger: CenterAgentMemoryLogger;
  query: string;
  ref: Parameters<CenterAgentMemoryAdapter["search"]>[0]["ref"];
  timeoutMs: number;
}): Promise<CenterAgentMemorySearchResult[]> {
  try {
    return await withTimeout(
      input.adapter.search({
        limit: input.limit,
        query: truncateMemorySearchQuery(input.query),
        ref: input.ref,
      }),
      input.timeoutMs,
      "center_agent_memory.recall_timeout"
    );
  } catch (error) {
    input.logger.warn("[core.center_agent_memory.recall_failed]", {
      error: toErrorMessage(error),
      organizationId: input.ref.subject.organizationId,
      subject: input.ref.subject.kind,
    });
    return [];
  }
}

function truncateMemorySearchQuery(query: string): string {
  const normalized = query.trim();
  if (normalized.length <= CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(
    0,
    CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS - 3
  )}...`;
}

function projectMemoryEnvelope(
  results: CenterAgentMemorySearchResult[]
): RecallCenterAgentMemoryForTurnResult {
  const items: RecallCenterAgentMemoryForTurnResult["items"] = [];
  let remainingChars = CENTER_AGENT_MEMORY_MAX_ENVELOPE_TEXT_CHARS;
  let truncated = results.length > CENTER_AGENT_MEMORY_MAX_ITEMS;

  for (const result of results.slice(0, CENTER_AGENT_MEMORY_MAX_ITEMS)) {
    const normalizedFact = normalizeMemoryText(result.text);
    if (!normalizedFact) {
      continue;
    }
    const normalizedText = formatMemoryText({
      captureMethod: result.captureMethod,
      occurredAtMs: result.occurredAtMs,
      text: normalizedFact,
    });
    const itemText = truncateMemoryText(
      normalizedText,
      CENTER_AGENT_MEMORY_MAX_ITEM_TEXT_CHARS
    );
    if (itemText.truncated) {
      truncated = true;
    }
    const text = itemText.text;
    if (text.length > remainingChars) {
      if (remainingChars <= 40) {
        truncated = true;
        break;
      }
      items.push(
        buildMemoryEnvelopeItem({
          result,
          text: truncateMemoryText(text, remainingChars).text,
        })
      );
      truncated = true;
      break;
    }
    items.push(buildMemoryEnvelopeItem({ result, text }));
    remainingChars -= text.length;
  }

  return { items, truncated };
}

function buildMemoryEnvelopeItem(input: {
  result: CenterAgentMemorySearchResult;
  text: string;
}): RecallCenterAgentMemoryForTurnResult["items"][number] {
  if (input.result.source === "message_channel_conversation") {
    if (!input.result.messageChannelProvider) {
      throw new Error(
        "Message Channel memory projection requires its provider"
      );
    }
    return {
      provider: input.result.messageChannelProvider,
      source: input.result.source,
      subject: input.result.subject,
      text: input.text,
    };
  }
  return {
    source: input.result.source,
    subject: input.result.subject,
    text: input.text,
  };
}

function formatMemoryText(input: {
  captureMethod: CenterAgentMemorySearchResult["captureMethod"];
  occurredAtMs: number;
  text: string;
}): string {
  const captureLabel =
    input.captureMethod === "explicit_save" ? " [Explicitly saved]" : "";
  return `[Recorded ${new Date(input.occurredAtMs).toISOString()}]${captureLabel} ${input.text}`;
}

function normalizeMemoryText(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized : null;
}

function truncateMemoryText(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars - 3)}...`,
    truncated: true,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reasonCode: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(reasonCode));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
