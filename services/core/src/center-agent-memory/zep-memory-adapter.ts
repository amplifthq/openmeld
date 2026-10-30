import type { Zep } from "@getzep/zep-cloud";
import {
  CENTER_AGENT_RETAINED_MEMORY_MAX_SOURCES,
  messageChannelProviderSchema,
} from "@openmeld/schemas";
import type { MessageChannelProvider } from "@openmeld/schemas/types";
import { loadZepRuntime } from "../lazy-runtime-modules";
import type {
  CenterAgentMemoryAdapter,
  CenterAgentMemoryCaptureMethod,
  CenterAgentMemoryDetailedReader,
  CenterAgentMemoryEpisode,
  CenterAgentMemoryRef,
  CenterAgentMemorySearchResult,
  CenterAgentMemorySource,
} from "./contract";

type ZepClientLike = {
  graph: {
    add(
      input: Zep.AddDataRequest,
      options?: { maxRetries: number }
    ): Promise<Zep.Episode>;
    create(input: Record<string, unknown>): Promise<unknown>;
    delete(input: string): Promise<unknown>;
    episode: {
      get(uuid: string): Promise<Zep.Episode>;
    };
    search(input: Zep.GraphSearchQuery): Promise<Zep.GraphSearchResults>;
  };
  user: {
    add(input: Record<string, unknown>): Promise<unknown>;
    delete(input: string): Promise<unknown>;
  };
};

type ZepMemoryAdapterLogger = Pick<Console, "warn">;

const ALREADY_EXISTS_ERROR_PATTERN = /already exists|conflict/i;
const NOT_FOUND_ERROR_PATTERN = /not found|missing/i;
const SOURCE_VERSION_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CENTER_AGENT_MEMORY_MAX_PROVENANCE_EPISODES_PER_EDGE =
  CENTER_AGENT_RETAINED_MEMORY_MAX_SOURCES;
const CENTER_AGENT_MEMORY_SOURCES = new Set<CenterAgentMemorySource>([
  "ca_dm",
  "explicit_tool",
  "message_channel_conversation",
  "slack_conversation",
  "space_conversation",
]);
const OPENMELD_MEMORY_METADATA_VERSION = 1;
const OPENMELD_MEMORY_METADATA_KEYS = {
  captureMethod: "openmeld_memory_capture_method",
  messageChannelProvider: "openmeld_message_channel_provider",
  occurredAtMs: "openmeld_memory_occurred_at_ms",
  source: "openmeld_memory_source",
  sourceConversationId: "openmeld_memory_source_conversation_id",
  sourceMessageId: "openmeld_memory_source_message_id",
  sourceVersion: "openmeld_memory_source_version",
  sourceAuthorKind: "openmeld_memory_source_author_kind",
  version: "openmeld_memory_version",
} as const;

type EpisodeProvenance = Omit<
  CenterAgentMemorySearchResult,
  "subject" | "text"
>;

type ProvenanceFailureReason =
  | "empty_fact"
  | "episode_read_failed"
  | "fact_contains_source_reference"
  | "invalid_episode_provenance"
  | "missing_episode_reference"
  | "too_many_episode_references";

type ProvenanceFailure = {
  edgeId: string;
  episodeId?: string;
  errorName?: string;
  reasonCode: ProvenanceFailureReason;
};

type MemorySearchReadResult =
  | {
      item: CenterAgentMemorySearchResult;
      sources: EpisodeProvenance[];
      status: "resolved";
    }
  | { failure: ProvenanceFailure; status: "omitted" };

export function createZepCenterAgentMemoryAdapter(input: {
  apiKey: string;
  logger?: ZepMemoryAdapterLogger;
}): CenterAgentMemoryAdapter & CenterAgentMemoryDetailedReader {
  const logger = input.logger ?? console;
  let clientPromise: Promise<ZepClientLike> | null = null;
  const getClient = (): Promise<ZepClientLike> => {
    clientPromise ??= loadZepRuntime().then(
      ({ ZepClient }) =>
        new ZepClient({ apiKey: input.apiKey }) as unknown as ZepClientLike
    );
    return clientPromise;
  };

  async function searchRecords(
    searchInput: Parameters<CenterAgentMemoryAdapter["search"]>[0],
    strictProvenance: boolean
  ) {
    const client = await getClient();
    const result = await client.graph.search({
      ...toZepGraphSelector(searchInput.ref),
      query: searchInput.query,
      limit: searchInput.limit,
      scope: "edges",
    });
    const episodeCache = new Map<string, Promise<Zep.Episode>>();
    const getEpisode = (episodeId: string): Promise<Zep.Episode> => {
      let episode = episodeCache.get(episodeId);
      if (!episode) {
        episode = client.graph.episode.get(episodeId);
        episodeCache.set(episodeId, episode);
      }
      return episode;
    };
    const records = await Promise.all(
      (result.edges ?? []).slice(0, searchInput.limit).map((edge) =>
        readMemorySearchResult({
          edge,
          getEpisode,
          subject: searchInput.ref.subject.kind,
          strictProvenance,
        })
      )
    );
    const failures = records.flatMap((record) =>
      record.status === "omitted" ? [record.failure] : []
    );
    if (failures.length > 0) {
      logger.warn("[core.center_agent_memory.provenance_unavailable]", {
        failureCount: failures.length,
        failures: failures.slice(0, 6),
        subject: searchInput.ref.subject.kind,
      });
    }
    return records;
  }

  return {
    async addEpisode(addInput) {
      const client = await getClient();
      const receipt = await client.graph.add(
        {
          ...toZepGraphSelector(addInput.ref),
          createdAt: formatTimestampMs(addInput.episode.occurredAtMs),
          data: formatEpisode(addInput.episode),
          metadata: buildEpisodeMetadata(addInput.episode),
          sourceDescription: formatEpisodeSourceDescription(addInput.episode),
          type: "message",
        },
        { maxRetries: 0 }
      );
      if (!receipt.uuid) {
        throw new Error("center_agent_memory.write_receipt_missing");
      }
      return { episodeId: receipt.uuid, processed: receipt.processed === true };
    },

    async deleteMemberUser(ref) {
      const client = await getClient();
      const zepUserId = requireZepUserId(ref);
      try {
        await client.user.delete(zepUserId);
        return "deleted";
      } catch (error) {
        if (isNotFoundError(error)) {
          return "not_found";
        }
        throw error;
      }
    },

    async deleteOrganizationGraph(ref) {
      const client = await getClient();
      const zepGraphId = requireZepGraphId(ref);
      try {
        await client.graph.delete(zepGraphId);
        return "deleted";
      } catch (error) {
        if (isNotFoundError(error)) {
          return "not_found";
        }
        throw error;
      }
    },

    async ensureMemberUser(ref) {
      const client = await getClient();
      try {
        await client.user.add({ userId: requireZepUserId(ref) });
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    },

    async ensureOrganizationGraph(ref) {
      const client = await getClient();
      try {
        await client.graph.create({ graphId: requireZepGraphId(ref) });
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    },

    async search(searchInput) {
      // Automatic prompt recall retains its existing single-origin projection.
      const records = await searchRecords(
        searchInput,
        searchInput.ref.subject.kind === "space"
      );
      return records.flatMap((record) =>
        record.status === "resolved"
          ? [
              {
                ...record.item,
                ...(searchInput.ref.subject.kind === "space" ||
                record.sources.some((source) => source.sourceAuthorKind)
                  ? { supportingSources: record.sources }
                  : {}),
              },
            ]
          : []
      );
    },
    async searchDetailed(searchInput) {
      const records = await searchRecords(searchInput, true);
      return {
        items: records.flatMap((record) =>
          record.status === "resolved"
            ? [
                {
                  text: record.item.text,
                  subject: record.item.subject,
                  sources: record.sources,
                },
              ]
            : []
        ),
        status: records.some((record) => record.status === "omitted")
          ? "partial"
          : "complete",
      };
    },
  };
}

function toZepGraphSelector(
  ref: CenterAgentMemoryRef
): Pick<Zep.GraphSearchQuery, "graphId" | "userId"> {
  if (ref.subject.kind === "member") {
    return { userId: requireZepUserId(ref) };
  }
  return { graphId: requireZepGraphId(ref) };
}

function requireZepUserId(ref: CenterAgentMemoryRef): string {
  if (!ref.zepUserId) {
    throw new Error("Center Agent member memory ref is missing zepUserId");
  }
  return ref.zepUserId;
}

function requireZepGraphId(ref: CenterAgentMemoryRef): string {
  if (!ref.zepGraphId) {
    throw new Error(
      "Center Agent organization memory ref is missing zepGraphId"
    );
  }
  return ref.zepGraphId;
}

function buildEpisodeMetadata(
  episode: CenterAgentMemoryEpisode
): Record<string, string | number> {
  const metadata: Record<string, string | number> = {
    [OPENMELD_MEMORY_METADATA_KEYS.captureMethod]: episode.captureMethod,
    [OPENMELD_MEMORY_METADATA_KEYS.occurredAtMs]: episode.occurredAtMs,
    [OPENMELD_MEMORY_METADATA_KEYS.source]: episode.source,
    [OPENMELD_MEMORY_METADATA_KEYS.sourceConversationId]:
      episode.sourceConversationId,
    [OPENMELD_MEMORY_METADATA_KEYS.sourceMessageId]: episode.sourceMessageId,
    [OPENMELD_MEMORY_METADATA_KEYS.version]: OPENMELD_MEMORY_METADATA_VERSION,
  };
  if (episode.source === "message_channel_conversation") {
    const provider = requireMessageChannelProvider(
      episode.messageChannelProvider
    );
    metadata[OPENMELD_MEMORY_METADATA_KEYS.messageChannelProvider] = provider;
  }
  if (episode.sourceVersion && episode.sourceAuthorKind) {
    metadata[OPENMELD_MEMORY_METADATA_KEYS.sourceVersion] =
      episode.sourceVersion;
    metadata[OPENMELD_MEMORY_METADATA_KEYS.sourceAuthorKind] =
      episode.sourceAuthorKind;
  }
  return metadata;
}

function formatEpisodeSourceDescription(
  episode: CenterAgentMemoryEpisode
): string {
  switch (episode.source) {
    case "ca_dm":
      return "OpenMeld Center Agent memory from Center Agent DM";
    case "explicit_tool":
      return "OpenMeld Center Agent memory from explicit save request";
    case "message_channel_conversation":
      return `OpenMeld Center Agent memory from ${formatMessageChannelProviderName(requireMessageChannelProvider(episode.messageChannelProvider))} conversation`;
    case "slack_conversation":
      return "OpenMeld Center Agent memory from Slack conversation";
    case "space_conversation":
      return "OpenMeld Center Agent memory from shared Space";
    default:
      throw new Error("Center Agent memory episode has an invalid source");
  }
}

function formatEpisode(episode: CenterAgentMemoryEpisode): string {
  if (episode.sourceVersion && episode.sourceAuthorKind) {
    const author = { human: "Human", agent: "Agent", system: "System notice" }[
      episode.sourceAuthorKind
    ];
    return `${author} (original source excerpt): ${episode.userMessage}`;
  }
  return [
    `User: ${episode.userMessage}`,
    `Center Agent: ${episode.assistantMessage}`,
  ].join("\n");
}

async function readMemorySearchResult(input: {
  edge: Zep.EntityEdge;
  getEpisode: (episodeId: string) => Promise<Zep.Episode>;
  subject: CenterAgentMemorySearchResult["subject"];
  strictProvenance?: boolean;
}): Promise<MemorySearchReadResult> {
  const edgeId = normalizeNonEmptyString(input.edge.uuid) ?? "unknown_edge";
  const text = normalizeNonEmptyString(input.edge.fact);
  if (!text) {
    return omittedProvenance({ edgeId, reasonCode: "empty_fact" });
  }
  if (
    input.strictProvenance &&
    (!Array.isArray(input.edge.episodes) ||
      input.edge.episodes.some(
        (value) => normalizeNonEmptyString(value) === null
      ))
  ) {
    return omittedProvenance({
      edgeId,
      reasonCode: "missing_episode_reference",
    });
  }
  const episodeIds = [
    ...new Set(
      (input.edge.episodes ?? [])
        .map(normalizeNonEmptyString)
        .filter((value): value is string => value !== null)
    ),
  ];
  if (episodeIds.length === 0) {
    return omittedProvenance({
      edgeId,
      reasonCode: "missing_episode_reference",
    });
  }
  if (
    episodeIds.length > CENTER_AGENT_MEMORY_MAX_PROVENANCE_EPISODES_PER_EDGE
  ) {
    return omittedProvenance({
      edgeId,
      reasonCode: "too_many_episode_references",
    });
  }
  const episodes = await Promise.allSettled(
    episodeIds.map(async (episodeId) => ({
      episode: await input.getEpisode(episodeId),
      episodeId,
    }))
  );
  const provenance: Array<{
    episodeId: string;
    value: EpisodeProvenance;
  }> = [];
  for (const [index, episodeResult] of episodes.entries()) {
    const episodeId = episodeIds[index];
    if (!episodeId) {
      return omittedProvenance({
        edgeId,
        reasonCode: "missing_episode_reference",
      });
    }
    if (episodeResult.status === "rejected") {
      return omittedProvenance({
        edgeId,
        episodeId,
        errorName: toErrorName(episodeResult.reason),
        reasonCode: "episode_read_failed",
      });
    }
    if (
      input.strictProvenance &&
      episodeResult.value.episode.uuid !== episodeId
    ) {
      return omittedProvenance({
        edgeId,
        episodeId,
        reasonCode: "invalid_episode_provenance",
      });
    }
    const parsed = parseEpisodeProvenance(episodeResult.value.episode);
    if (!parsed) {
      return omittedProvenance({
        edgeId,
        episodeId,
        reasonCode: "invalid_episode_provenance",
      });
    }
    provenance.push({ episodeId, value: parsed });
  }
  const exposedReference = provenance.find(({ value }) =>
    factContainsSourceReference(text, value)
  );
  if (exposedReference) {
    return omittedProvenance({
      edgeId,
      episodeId: exposedReference.episodeId,
      reasonCode: "fact_contains_source_reference",
    });
  }
  provenance.sort(
    (left, right) =>
      left.value.occurredAtMs - right.value.occurredAtMs ||
      left.episodeId.localeCompare(right.episodeId)
  );
  const original = provenance[0];
  if (!original) {
    return omittedProvenance({
      edgeId,
      reasonCode: "missing_episode_reference",
    });
  }
  return {
    item: {
      ...original.value,
      subject: input.subject,
      text: formatFactValidity(input.edge, text),
      ...spaceFactValidity(input.subject, input.edge),
    },
    sources: provenance.map(({ value }) => value),
    status: "resolved",
  };
}

function spaceFactValidity(
  subject: CenterAgentMemorySearchResult["subject"],
  edge: Zep.EntityEdge
): Pick<CenterAgentMemorySearchResult, "validity"> {
  if (subject !== "space") {
    return {};
  }
  const invalidAtMs = edge.invalidAt ? Date.parse(edge.invalidAt) : Number.NaN;
  const expiredAtMs = edge.expiredAt ? Date.parse(edge.expiredAt) : Number.NaN;
  if (!(Number.isFinite(invalidAtMs) || Number.isFinite(expiredAtMs))) {
    return {};
  }
  return {
    validity: {
      ...(Number.isFinite(invalidAtMs) ? { invalidAtMs } : {}),
      ...(Number.isFinite(expiredAtMs) ? { expiredAtMs } : {}),
    },
  };
}

function formatFactValidity(edge: Zep.EntityEdge, text: string): string {
  const dates = [
    ["from", edge.validAt],
    ["until", edge.invalidAt],
    ["superseded", edge.expiredAt],
  ].flatMap(([label, value]) => {
    const timestamp = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(timestamp)
      ? [`${label} ${new Date(timestamp).toISOString()}`]
      : [];
  });
  return `[Fact validity: ${dates.length ? dates.join("; ") : "unknown"}] ${text}`;
}

function omittedProvenance(failure: ProvenanceFailure): MemorySearchReadResult {
  return { failure, status: "omitted" };
}

function factContainsSourceReference(
  fact: string,
  provenance: EpisodeProvenance
): boolean {
  return [provenance.sourceConversationId, provenance.sourceMessageId].some(
    (reference) => fact.includes(reference)
  );
}

function parseEpisodeProvenance(
  episode: Zep.Episode
): EpisodeProvenance | null {
  const metadataVersion =
    episode.metadata?.[OPENMELD_MEMORY_METADATA_KEYS.version];
  if (metadataVersion === OPENMELD_MEMORY_METADATA_VERSION) {
    return parseStructuredEpisodeProvenance(episode.metadata ?? {});
  }
  return parseLegacyEpisodeProvenance(episode.content);
}

function parseStructuredEpisodeProvenance(
  metadata: Record<string, unknown>
): EpisodeProvenance | null {
  const provenance = buildParsedProvenance({
    captureMethod: metadata[OPENMELD_MEMORY_METADATA_KEYS.captureMethod],
    messageChannelProvider:
      metadata[OPENMELD_MEMORY_METADATA_KEYS.messageChannelProvider],
    occurredAtMs: metadata[OPENMELD_MEMORY_METADATA_KEYS.occurredAtMs],
    source: metadata[OPENMELD_MEMORY_METADATA_KEYS.source],
    sourceConversationId:
      metadata[OPENMELD_MEMORY_METADATA_KEYS.sourceConversationId],
    sourceMessageId: metadata[OPENMELD_MEMORY_METADATA_KEYS.sourceMessageId],
  });
  const version = metadata[OPENMELD_MEMORY_METADATA_KEYS.sourceVersion];
  const authorKind = metadata[OPENMELD_MEMORY_METADATA_KEYS.sourceAuthorKind];
  if (version === undefined && authorKind === undefined) {
    return provenance;
  }
  if (
    !provenance ||
    typeof version !== "string" ||
    !SOURCE_VERSION_PATTERN.test(version) ||
    (authorKind !== "human" &&
      authorKind !== "agent" &&
      authorKind !== "system")
  ) {
    return null;
  }
  return {
    ...provenance,
    sourceVersion: version,
    sourceAuthorKind: authorKind,
  };
}

function parseLegacyEpisodeProvenance(
  content: string
): EpisodeProvenance | null {
  const source = readLegacyEpisodeHeader(content, "Source");
  const sourceConversationId = readLegacyEpisodeHeader(content, "Conversation");
  return buildParsedProvenance({
    captureMethod: undefined,
    messageChannelProvider:
      source === "message_channel_conversation"
        ? sourceConversationId?.split(":", 1)[0]
        : undefined,
    occurredAtMs: Date.parse(
      readLegacyEpisodeHeader(content, "Occurred at") ?? ""
    ),
    source,
    sourceConversationId,
    sourceMessageId: readLegacyEpisodeHeader(content, "Message"),
  });
}

function readLegacyEpisodeHeader(content: string, name: string): string | null {
  const match = content.match(new RegExp(`^${name}:\\s*(.+)$`, "mu"));
  return normalizeNonEmptyString(match?.[1]);
}

function buildParsedProvenance(input: {
  captureMethod: unknown;
  messageChannelProvider: unknown;
  occurredAtMs: unknown;
  source: unknown;
  sourceConversationId: unknown;
  sourceMessageId: unknown;
}): EpisodeProvenance | null {
  const occurredAtMs = parseTimestampMs(input.occurredAtMs);
  const source = parseMemorySource(input.source);
  const captureMethod = parseCaptureMethod(input.captureMethod, source);
  const sourceConversationId = normalizeNonEmptyString(
    input.sourceConversationId
  );
  const sourceMessageId = normalizeNonEmptyString(input.sourceMessageId);
  if (
    !(
      occurredAtMs !== null &&
      captureMethod &&
      source &&
      sourceConversationId &&
      sourceMessageId
    )
  ) {
    return null;
  }
  if (source === "message_channel_conversation") {
    const providerResult = messageChannelProviderSchema.safeParse(
      input.messageChannelProvider
    );
    if (!providerResult.success) {
      return null;
    }
    return {
      captureMethod,
      messageChannelProvider: providerResult.data,
      occurredAtMs,
      source,
      sourceConversationId,
      sourceMessageId,
    };
  }
  return {
    captureMethod,
    occurredAtMs,
    source,
    sourceConversationId,
    sourceMessageId,
  };
}

function parseCaptureMethod(
  value: unknown,
  source: CenterAgentMemorySource | null
): CenterAgentMemoryCaptureMethod | null {
  if (value === "automatic_turn" || value === "explicit_save") {
    return value;
  }
  if (value === undefined && source) {
    return source === "explicit_tool" ? "explicit_save" : "automatic_turn";
  }
  return null;
}

function parseMemorySource(value: unknown): CenterAgentMemorySource | null {
  const normalized = normalizeNonEmptyString(value);
  return normalized &&
    CENTER_AGENT_MEMORY_SOURCES.has(normalized as CenterAgentMemorySource)
    ? (normalized as CenterAgentMemorySource)
    : null;
}

function parseTimestampMs(value: unknown): number | null {
  const timestamp = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(timestamp) &&
    timestamp >= 0 &&
    Number.isFinite(new Date(timestamp).getTime())
    ? timestamp
    : null;
}

function formatTimestampMs(value: number): string {
  const timestamp = parseTimestampMs(value);
  if (timestamp === null) {
    throw new Error("Center Agent memory episode occurrence time is invalid");
  }
  return new Date(timestamp).toISOString();
}

function requireMessageChannelProvider(
  value: MessageChannelProvider | undefined
): MessageChannelProvider {
  if (!value) {
    throw new Error(
      "Message Channel memory episode requires its source provider"
    );
  }
  return value;
}

function formatMessageChannelProviderName(
  provider: MessageChannelProvider
): string {
  switch (provider) {
    case "feishu":
      return "Feishu";
    case "lark":
      return "Lark";
    case "slack":
      return "Slack";
    default:
      throw new Error("Center Agent memory episode has an invalid provider");
  }
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    isZepStatus(error, 409) ||
    ALREADY_EXISTS_ERROR_PATTERN.test(toMessage(error))
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    isZepStatus(error, 404) || NOT_FOUND_ERROR_PATTERN.test(toMessage(error))
  );
}

function isZepStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record.statusCode === status || record.status === status;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
