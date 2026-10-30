import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  buildCenterAgentSpaceMemoryRef,
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
  type CenterAgentMemorySpaceAccess,
  type RecallCenterAgentMemoryForTurnInput,
  type RecallCenterAgentMemoryForTurnResult,
  type RecallCenterAgentOrganizationMemoryInput,
  type RememberCenterAgentTurnInput,
} from "./contract";
import { interleaveMemoryScopes } from "./memory-selection";

export type CenterAgentMemoryService = {
  deleteSpaceMemory(input: {
    organizationId: string;
    spaceId: string;
  }): Promise<"deleted" | "not_found">;
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
  }): Promise<{ status: "processing" | "processed" }>;
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
  spaceAccess?: CenterAgentMemorySpaceAccess;
  waitUntil?: (promise: Promise<unknown>) => void;
}): CenterAgentMemoryService {
  const nowMs = input.nowMs ?? Date.now;
  const logger = input.logger ?? console;
  const recallTimeoutMs =
    input.recallTimeoutMs ?? CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS;
  const writeTimeoutMs =
    input.writeTimeoutMs ?? CENTER_AGENT_MEMORY_WRITE_TIMEOUT_MS;

  async function recallRetained(
    recallInput:
      | RecallCenterAgentMemoryForTurnInput
      | RecallCenterAgentOrganizationMemoryInput
  ) {
    const spaceRead =
      "spaceId" in recallInput &&
      recallInput.spaceId &&
      "speakerMember" in recallInput
        ? {
            organizationId: recallInput.organizationId,
            spaceId: recallInput.spaceId,
            speakerMember: recallInput.speakerMember,
          }
        : null;
    const allowedSpace =
      spaceRead && (await input.spaceAccess?.canRead(spaceRead));
    const readInput = {
      ...recallInput,
      spaceId: allowedSpace ? spaceRead.spaceId : undefined,
    };
    const refs = (await input.repository.readActiveSubjects(readInput)).filter(
      (ref) =>
        ref.subject.kind !== "space" ||
        (allowedSpace && ref.subject.spaceId === spaceRead.spaceId)
    );
    const sourceReads = new Map<
      string,
      ReturnType<CenterAgentMemorySpaceAccess["readSource"]>
    >();
    async function isCurrentSpaceSource(
      source: CenterAgentMemoryEpisodeOrigin
    ) {
      if (
        !(spaceRead && input.spaceAccess) ||
        source.source !== "space_conversation" ||
        source.sourceConversationId !== spaceRead.spaceId ||
        !source.sourceVersion
      ) {
        return false;
      }
      let read = sourceReads.get(source.sourceMessageId);
      if (!read) {
        if (sourceReads.size >= 48) {
          return false;
        }
        read = input.spaceAccess.readSource({
          ...spaceRead,
          signalId: source.sourceMessageId,
        });
        sourceReads.set(source.sourceMessageId, read);
      }
      const current = await read;
      return (
        current?.version === source.sourceVersion &&
        current.author.profileKind === source.sourceAuthorKind
      );
    }
    async function checkSpaceSources(results: CenterAgentMemorySearchResult[]) {
      const accepted = await Promise.all(
        results.map(async (candidate) => {
          const supports = candidate.supportingSources ?? [candidate];
          if (!supports.length) {
            return null;
          }
          const current = await Promise.all(supports.map(isCurrentSpaceSource));
          if (!current.every(Boolean)) {
            return null;
          }
          const speakers = new Map<
            string,
            NonNullable<
              Awaited<ReturnType<CenterAgentMemorySpaceAccess["readSource"]>>
            >["author"]
          >();
          for (const source of supports) {
            const snapshot = await sourceReads.get(source.sourceMessageId);
            if (snapshot) {
              speakers.set(snapshot.author.profileId, snapshot.author);
            }
          }
          return { ...candidate, sourceSpeakers: [...speakers.values()] };
        })
      );
      const facts = accepted.filter((candidate) => candidate !== null);
      const evidence = new Map<string, CenterAgentMemorySearchResult>();
      for (const fact of facts) {
        for (const source of selectGroundingSources(fact)) {
          if (evidence.has(source.sourceMessageId)) {
            continue;
          }
          const snapshot = await sourceReads.get(source.sourceMessageId);
          if (!snapshot) {
            continue;
          }
          evidence.set(source.sourceMessageId, {
            ...source,
            subject: "space",
            representation: "source_message",
            text: `Original source message (historical evidence): ${JSON.stringify({ author: snapshot.author, receivedBy: "Center Agent", text: snapshot.text })}`,
            supportingSources: [source],
          });
        }
      }
      return [...evidence.values()]
        .sort((left, right) => right.occurredAtMs - left.occurredAtMs)
        .concat(facts);
    }
    const results = await Promise.all(
      refs.map((ref) =>
        recallMemory({
          adapter: input.adapter,
          limit: CENTER_AGENT_MEMORY_MAX_ITEMS,
          logger,
          query: recallInput.query,
          ref,
          timeoutMs: recallTimeoutMs,
          ...(ref.subject.kind === "space"
            ? { validate: checkSpaceSources }
            : {}),
        })
      )
    );
    const stillAllowed =
      spaceRead && (await input.spaceAccess?.canRead(spaceRead));
    const currentRefs = (
      await input.repository.readActiveSubjects(readInput)
    ).filter((ref) => ref.subject.kind !== "space" || stillAllowed);
    const currentResults = results.filter((_, index) =>
      currentRefs.some(
        (current) =>
          current.subjectId === refs[index]?.subjectId &&
          current.updatedAtMs === refs[index]?.updatedAtMs
      )
    );
    const successfulResults = currentResults.filter(
      (result) => result !== null
    );
    const memory = projectMemoryEnvelope(
      interleaveMemoryScopes(successfulResults)
    );
    if (successfulResults.length < currentResults.length) {
      memory.status = successfulResults.length > 0 ? "partial" : "unavailable";
    }
    return memory;
  }

  return {
    async deleteSpaceMemory(deleteInput) {
      const ref = buildCenterAgentSpaceMemoryRef(deleteInput);
      await input.repository.beginSpaceDeletion({
        ...deleteInput,
        nowMs: nowMs(),
      });
      try {
        const status = await withTimeout(
          input.adapter.deleteOrganizationGraph(ref),
          writeTimeoutMs,
          "center_agent_memory.space_delete_timeout"
        );
        const existed = await input.repository.markSpaceDeleted({
          ...deleteInput,
          deletedAtMs: nowMs(),
        });
        return existed || status === "deleted" ? "deleted" : "not_found";
      } catch (error) {
        await input.repository.markSpaceDeleteFailed({
          ...deleteInput,
          nowMs: nowMs(),
          error: toErrorMessage(error),
        });
        throw error;
      }
    },
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
      return await recallRetained(recallInput);
    },
    async recallForOrganization(recallInput) {
      return await recallRetained(recallInput);
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
        assistantMessage:
          "The member asked to remember this fact for the organization.",
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
      const receipt = await withTimeout(
        input.adapter.addEpisode({ episode, ref: organizationRef }),
        writeTimeoutMs,
        "center_agent_memory.organization_write_timeout"
      );
      return { status: receipt.processed ? "processed" : "processing" };
    },
    async rememberTurn(rememberInput) {
      if (
        rememberInput.interactionEnvironment === "organization_shared" &&
        rememberInput.source === "space_conversation"
      ) {
        const policy = await input.repository.readPolicy(
          rememberInput.organizationId
        );
        if (!(policy.organizationMemoryOptIn && input.spaceAccess)) {
          return;
        }
        const access = {
          organizationId: rememberInput.organizationId,
          spaceId: rememberInput.sourceConversationId,
          speakerMember: rememberInput.speakerMember,
        };
        const source = await input.spaceAccess.readSource({
          ...access,
          signalId: rememberInput.sourceMessageId,
        });
        if (!source) {
          throw new Error("center_agent_memory.space_source_unavailable");
        }
        if (!source.text.trim()) {
          return;
        }
        const ref = await input.repository.upsertSpaceSubject({
          organizationId: access.organizationId,
          spaceId: access.spaceId,
          nowMs: nowMs(),
        });
        const write = (async () => {
          await input.adapter.ensureOrganizationGraph(ref);
          if (
            !(
              (await input.repository.isSpaceSubjectActive(access)) &&
              (await input.repository.readPolicy(access.organizationId))
                .organizationMemoryOptIn &&
              (await input.spaceAccess?.canRead(access))
            )
          ) {
            return;
          }
          await input.adapter.addEpisode({
            ref,
            episode: {
              source: "space_conversation",
              sourceConversationId: access.spaceId,
              sourceMessageId: rememberInput.sourceMessageId,
              captureMethod: "automatic_turn",
              assistantMessage: "",
              userMessage: source.text,
              occurredAtMs: source.occurredAtMs,
              sourceVersion: source.version,
              sourceAuthorKind: source.author.profileKind,
            },
          });
          if (!(await input.repository.isSpaceSubjectActive(access))) {
            try {
              await input.adapter.deleteOrganizationGraph(ref);
            } catch (error) {
              await input.repository.markSpaceDeleteFailed({
                ...access,
                nowMs: nowMs(),
                error: toErrorMessage(error),
              });
              throw error;
            }
          }
        })();
        input.waitUntil?.(write);
        await withTimeout(
          write,
          writeTimeoutMs,
          "center_agent_memory.space_write_timeout"
        );
        return;
      }
      // Provider Channels keep their existing capture policy. A Space capture
      // never becomes Organization memory or an individual member's episode.
      if (rememberInput.interactionEnvironment !== "requester_private") {
        return;
      }
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
function selectGroundingSources(fact: CenterAgentMemorySearchResult) {
  const supports = fact.supportingSources ?? [fact];
  if ((fact.sourceSpeakers?.length ?? 0) > 1) {
    return supports;
  }
  if (
    fact.validity?.invalidAtMs === undefined &&
    fact.validity?.expiredAtMs === undefined
  ) {
    return [];
  }
  return supports
    .filter((source) => source.occurredAtMs > fact.occurredAtMs)
    .sort((left, right) => right.occurredAtMs - left.occurredAtMs)
    .slice(0, 1);
}
async function recallMemory(input: {
  adapter: CenterAgentMemoryAdapter;
  limit: number;
  logger: CenterAgentMemoryLogger;
  query: string;
  ref: Parameters<CenterAgentMemoryAdapter["search"]>[0]["ref"];
  timeoutMs: number;
  validate?: (
    results: CenterAgentMemorySearchResult[]
  ) => Promise<CenterAgentMemorySearchResult[]>;
}): Promise<CenterAgentMemorySearchResult[] | null> {
  try {
    return await withTimeout(
      input.adapter
        .search({
          limit: input.limit,
          query: truncateMemorySearchQuery(input.query),
          ref: input.ref,
        })
        .then((results) =>
          input.validate ? input.validate(results) : results
        ),
      input.timeoutMs,
      "center_agent_memory.recall_timeout"
    );
  } catch (error) {
    input.logger.warn("[core.center_agent_memory.recall_failed]", {
      error: toErrorMessage(error),
      organizationId: input.ref.subject.organizationId,
      subject: input.ref.subject.kind,
    });
    return null;
  }
}
function truncateMemorySearchQuery(query: string): string {
  const normalized = query.trim();
  if (normalized.length <= CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS - 3)}...`;
}
function projectMemoryEnvelope(
  results: CenterAgentMemorySearchResult[]
): RecallCenterAgentMemoryForTurnResult {
  const items: RecallCenterAgentMemoryForTurnResult["items"] = [];
  let remainingChars = CENTER_AGENT_MEMORY_MAX_ENVELOPE_TEXT_CHARS;
  const candidates = results.filter((result) =>
    normalizeMemoryText(result.text)
  );
  let truncated = false;

  for (const result of candidates) {
    const normalizedFact =
      result.representation === "source_message"
        ? result.text.trim()
        : normalizeMemoryText(result.text);
    if (!normalizedFact) {
      continue;
    }
    const normalizedText = formatMemoryText({
      captureMethod: result.captureMethod,
      occurredAtMs: result.occurredAtMs,
      text: normalizedFact,
      sourceAuthors:
        result.representation === "source_message"
          ? []
          : (result.sourceSpeakers?.map(
              (speaker) =>
                `${speaker.profileKind} ${JSON.stringify(speaker.profileName)} (${speaker.profileId})`
            ) ??
            [
              ...new Set(
                (result.supportingSources ?? [result]).flatMap((source) =>
                  source.sourceAuthorKind ? [source.sourceAuthorKind] : []
                )
              ),
            ].sort()),
    });
    if (
      items.length >= CENTER_AGENT_MEMORY_MAX_ITEMS ||
      normalizedText.length >
        Math.min(CENTER_AGENT_MEMORY_MAX_ITEM_TEXT_CHARS, remainingChars)
    ) {
      truncated = true;
      continue;
    }
    const text = normalizedText;
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
  sourceAuthors?: string[];
}): string {
  const captureLabel =
    input.captureMethod === "explicit_save" ? " [Explicitly saved]" : "";
  const authors = input.sourceAuthors?.length
    ? ` [Source authors: ${input.sourceAuthors.join(", ")}]`
    : "";
  return `[Recorded ${new Date(input.occurredAtMs).toISOString()}]${captureLabel}${authors} ${input.text}`;
}
function normalizeMemoryText(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized : null;
}
export { withTimeout as withCenterAgentMemoryTimeout };
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
